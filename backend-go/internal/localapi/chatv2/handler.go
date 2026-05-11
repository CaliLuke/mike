package chatv2

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/i2y/romancy"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var handlerTracer = otel.Tracer("luke/localapi/chatv2/handler")

// Enabled reports whether the V2 chat path is active. V2 is the default;
// set LUKE_CHAT_V1=true to opt back into the legacy path during the
// deletion-phase migration window (see
// /Users/luca/.claude/plans/yeah-sounds-more-reasonable-shimmering-sunrise.md).
//
// LUKE_CHAT_V2 is honored for symmetry — explicitly setting it to a falsy
// value forces V1, and setting it truthy is a no-op now that V2 is default.
func Enabled() bool {
	if isTruthy(os.Getenv("LUKE_CHAT_V1")) {
		return false
	}
	if v := os.Getenv("LUKE_CHAT_V2"); v != "" && !isTruthy(v) {
		return false
	}
	return true
}

func isTruthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// HeaderName tells the frontend which dispatcher to use. Setting v1 explicitly
// (rather than relying on absence) keeps the dispatch a single read.
const (
	HeaderName    = "X-Luke-Chat-Version"
	HeaderValueV2 = "v2"
)

// Request mirrors the chat handler request shape so we can decode it without
// reaching back into the localapi package (avoids an import cycle).
type Request struct {
	ChatID            *string             `json:"chat_id"`
	Model             *string             `json:"model"`
	Messages          []RequestMessage    `json:"messages"`
	DisplayedDoc      *RequestFile        `json:"displayed_doc"`
	AttachedDocuments []RequestFile       `json:"attached_documents"`
	Workflow          *RequestWorkflowRef `json:"workflow"`
}

type RequestMessage struct {
	Role     string              `json:"role"`
	Content  string              `json:"content"`
	Files    []RequestFile       `json:"files"`
	Workflow *RequestWorkflowRef `json:"workflow"`
}

type RequestFile struct {
	Filename   string `json:"filename"`
	DocumentID string `json:"document_id"`
}

type RequestWorkflowRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Dependencies bundles the callers' helpers the handler needs. Filled in by
// the localapi package at wire-up time so this package stays decoupled.
type Dependencies struct {
	Registry *Registry
	Service  *Service
	Romancy  *romancy.App
	// CreateChat creates a new chat row and returns its bare id (no record
	// prefix). Matches Server.createChat semantics on the V1 path so we keep
	// the same chat row shape.
	CreateChat func(ctx context.Context, applicationID *string) (chatID string, err error)
	// PersistUserMessage writes the user-side row to chat_messages so the
	// assistant message has a peer to reference. Returns the new message id.
	PersistUserMessage func(ctx context.Context, chatID, content string) (messageID string, err error)
	// DefaultModel resolves the model name when the request omits it.
	DefaultModel func(*string) string
	// NewID generates a fresh id for a given prefix ("chatmsg", etc.).
	NewID func(prefix string) string
}

// Handler returns an http.HandlerFunc that serves POST /chat (and friends)
// under the V2 path. The SSE forwarding loop is wrapped in its own span
// (chatv2.sse.handler) so per-event throughput, flush count, exit reason,
// and the bus counters are visible after the request ends.
func Handler(deps Dependencies, applicationID *string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, span := handlerTracer.Start(r.Context(), "chatv2.sse.handler")
		defer span.End()
		if applicationID != nil {
			span.SetAttributes(attribute.String("application.id", *applicationID))
		}

		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		_ = r.Body.Close()

		chatID := ""
		if req.ChatID != nil {
			chatID = strings.TrimPrefix(*req.ChatID, "chats:")
		}
		span.SetAttributes(attribute.Bool("chat.existing", chatID != ""))
		if chatID == "" {
			created, err := deps.CreateChat(ctx, applicationID)
			if err != nil {
				recordHandlerError(span, "create_chat", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			chatID = created
		}
		span.SetAttributes(attribute.String("chat.id", chatID))

		bus := deps.Registry.GetOrCreate(chatID)
		ch, unsubscribe := bus.Subscribe()
		defer unsubscribe()

		w.Header().Set(HeaderName, HeaderValueV2)
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)

		userText := ""
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if req.Messages[i].Role == "user" {
				userText = req.Messages[i].Content
				break
			}
		}
		span.SetAttributes(
			attribute.Int("chat.user_message_chars", len(userText)),
			attribute.Int("chat.request_message_count", len(req.Messages)),
			attribute.Int("chat.attached_document_count", len(req.AttachedDocuments)),
			attribute.Bool("chat.has_displayed_doc", req.DisplayedDoc != nil),
		)

		userMsgID, err := deps.PersistUserMessage(ctx, chatID, userText)
		if err != nil {
			recordHandlerError(span, "persist_user_message", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		assistantMsgID := deps.NewID("chatmsg")
		instanceID := fmt.Sprintf("chatv2_%s_%s", chatID, deps.NewID("run"))
		model := deps.DefaultModel(req.Model)
		span.SetAttributes(
			attribute.String("chat.user_message_id", userMsgID),
			attribute.String("chat.assistant_message_id", assistantMsgID),
			attribute.String("workflow.instance_id", instanceID),
			attribute.String("assistant.model", model),
		)

		_, err = romancy.StartWorkflow(
			context.Background(), // workflow goroutine outlives request ctx by design
			deps.Romancy,
			deps.Service.Workflow(),
			Input{
				ChatID:             chatID,
				ApplicationID:      applicationID,
				UserMessage:        userText,
				UserMessageID:      userMsgID,
				AssistantMessageID: assistantMsgID,
				Model:              model,
			},
			romancy.WithInstanceID(instanceID),
		)
		if err != nil {
			recordHandlerError(span, "start_workflow", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Forward events from the bus until the workflow signals completion
		// or the client disconnects. Track everything an observer would want
		// to know if the chat got stuck: per-type event counts, flush count,
		// first/last event timing, bytes written, exit reason.
		eventCount := 0
		flushCount := 0
		bytesWritten := 0
		var firstEventAt time.Time
		var firstContentDeltaAt time.Time
		var firstChatCompletedAt time.Time
		typeCounts := map[EventType]int{}
		exitReason := "unknown"
		streamStartedAt := time.Now()
	loop:
		for {
			select {
			case <-r.Context().Done():
				exitReason = "client_disconnected"
				break loop
			case ev, ok := <-ch:
				if !ok {
					exitReason = "channel_closed"
					break loop
				}
				if firstEventAt.IsZero() {
					firstEventAt = time.Now()
				}
				if firstContentDeltaAt.IsZero() && ev.Type == EventContentDelta {
					firstContentDeltaAt = time.Now()
				}
				if firstChatCompletedAt.IsZero() && ev.Type == EventChatCompleted {
					firstChatCompletedAt = time.Now()
				}
				n, err := writeSSE(w, ev)
				if err != nil {
					recordHandlerError(span, "write_sse", err)
					exitReason = "write_error"
					break loop
				}
				bytesWritten += n
				if flusher != nil {
					flusher.Flush()
					flushCount++
				}
				eventCount++
				typeCounts[ev.Type]++
				if ev.Type == EventChatCompleted {
					exitReason = "chat_completed"
					break loop
				}
				if ev.Type == EventBackendError {
					exitReason = "backend_error"
					break loop
				}
			}
		}

		recordHandlerExit(
			span,
			exitReason,
			eventCount,
			flushCount,
			bytesWritten,
			typeCounts,
			streamStartedAt,
			firstEventAt,
			firstContentDeltaAt,
			firstChatCompletedAt,
			bus.Stats(),
		)
	}
}

func recordHandlerError(span trace.Span, where string, err error) {
	span.RecordError(err)
	span.SetStatus(codes.Error, where+": "+err.Error())
	span.SetAttributes(attribute.String("chatv2.sse.error_at", where))
}

func recordHandlerExit(
	span trace.Span,
	reason string,
	eventCount int,
	flushCount int,
	bytesWritten int,
	typeCounts map[EventType]int,
	streamStartedAt time.Time,
	firstEventAt time.Time,
	firstContentDeltaAt time.Time,
	firstChatCompletedAt time.Time,
	bus BroadcasterStats,
) {
	span.SetAttributes(
		attribute.String("chatv2.sse.exit_reason", reason),
		attribute.Int("chatv2.sse.event_count", eventCount),
		attribute.Int("chatv2.sse.flush_count", flushCount),
		attribute.Int("chatv2.sse.bytes_written", bytesWritten),
		attribute.Float64("chatv2.sse.duration_ms", float64(time.Since(streamStartedAt).Milliseconds())),
	)
	if !firstEventAt.IsZero() {
		span.SetAttributes(attribute.Float64(
			"chatv2.sse.time_to_first_event_ms",
			float64(firstEventAt.Sub(streamStartedAt).Milliseconds()),
		))
	}
	if !firstContentDeltaAt.IsZero() {
		span.SetAttributes(attribute.Float64(
			"chatv2.sse.time_to_first_content_delta_ms",
			float64(firstContentDeltaAt.Sub(streamStartedAt).Milliseconds()),
		))
	}
	if !firstChatCompletedAt.IsZero() {
		span.SetAttributes(attribute.Float64(
			"chatv2.sse.time_to_chat_completed_ms",
			float64(firstChatCompletedAt.Sub(streamStartedAt).Milliseconds()),
		))
	}
	for t, c := range typeCounts {
		span.SetAttributes(attribute.Int("chatv2.sse.count."+string(t), c))
	}
	span.SetAttributes(
		attribute.Int64("chatv2.bus.published", bus.Published),
		attribute.Int64("chatv2.bus.delivered", bus.Delivered),
		attribute.Int64("chatv2.bus.blocked_count", bus.BlockedCount),
		attribute.Float64("chatv2.bus.blocked_total_ms", bus.BlockedTotalMs),
		attribute.Float64("chatv2.bus.max_blocked_ms", bus.MaxBlockedMs),
		attribute.Int64("chatv2.bus.max_subscribers", bus.MaxSubscribers),
		attribute.Int64("chatv2.bus.total_subscribed", bus.TotalSubscribed),
		attribute.Int("chatv2.bus.active_subscribers", bus.ActiveSubscribers),
	)
	if reason != "chat_completed" {
		span.SetStatus(codes.Error, "sse exit reason="+reason)
	}
}

// writeSSE returns the number of bytes written for byte-counting on the span.
func writeSSE(w http.ResponseWriter, e Event) (int, error) {
	data, err := json.Marshal(e.Payload)
	if err != nil {
		return 0, err
	}
	return fmt.Fprintf(w, "event: message\ndata: %s\n\n", data)
}
