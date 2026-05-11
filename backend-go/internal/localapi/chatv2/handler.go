package chatv2

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/i2y/romancy"
)

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
// under the V2 path. P0 emits chat_started + chat_completed only; later
// phases replace the body with the real workflow invocation.
func Handler(deps Dependencies, applicationID *string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		_ = r.Body.Close()

		chatID := ""
		if req.ChatID != nil {
			chatID = strings.TrimPrefix(*req.ChatID, "chats:")
		}
		if chatID == "" {
			created, err := deps.CreateChat(r.Context(), applicationID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			chatID = created
		}

		bus := deps.Registry.GetOrCreate(chatID)
		ch, unsubscribe := bus.Subscribe()
		defer unsubscribe()

		w.Header().Set(HeaderName, HeaderValueV2)
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)

		// Extract the user's last message + persist it before kicking off the
		// workflow so history matches what the workflow will load on resume.
		userText := ""
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if req.Messages[i].Role == "user" {
				userText = req.Messages[i].Content
				break
			}
		}
		userMsgID, err := deps.PersistUserMessage(r.Context(), chatID, userText)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		assistantMsgID := deps.NewID("chatmsg")
		instanceID := fmt.Sprintf("chatv2_%s_%s", chatID, deps.NewID("run"))
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
				Model:              deps.DefaultModel(req.Model),
			},
			romancy.WithInstanceID(instanceID),
		)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Forward events from the bus until the workflow signals completion
		// or the client disconnects.
		for {
			select {
			case <-r.Context().Done():
				return
			case ev, ok := <-ch:
				if !ok {
					return
				}
				if err := writeSSE(w, ev); err != nil {
					return
				}
				if flusher != nil {
					flusher.Flush()
				}
				if ev.Type == EventChatCompleted || ev.Type == EventBackendError {
					return
				}
			}
		}
	}
}

func writeSSE(w http.ResponseWriter, e Event) error {
	data, err := json.Marshal(e.Payload)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: message\ndata: %s\n\n", data)
	return err
}
