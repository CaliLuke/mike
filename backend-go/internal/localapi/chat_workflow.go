package localapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/i2y/romancy"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

const chatExecutionWorkflowName = "chat_execution"

type chatExecutionInput struct {
	AppID              string               `json:"app_id"`
	ChatID             string               `json:"chat_id"`
	UserMessageID      string               `json:"user_message_id"`
	AssistantMessageID string               `json:"assistant_message_id"`
	Model              *string              `json:"model,omitempty"`
	ApplicationID      *string              `json:"application_id,omitempty"`
	TabularReviewID    *string              `json:"tabular_review_id,omitempty"`
	Messages           []chatRequestMessage `json:"messages"`
	DisplayedDoc       *chatRequestFile     `json:"displayed_doc,omitempty"`
	AttachedDocuments  []chatRequestFile    `json:"attached_documents,omitempty"`
}

type chatExecutionResult struct {
	ChatID string `json:"chat_id"`
	Text   string `json:"text"`
}

var chatExecutionServers = struct {
	sync.Mutex
	byAppID map[string]*Server
}{byAppID: map[string]*Server{}}

// executeChatActivity runs the long-lived chat streaming loop. It is marked
// non-transactional because the default wraps the entire activity in a
// SQLite transaction on romancy.db, holding the writer lock for the whole
// LLM stream (30+ seconds). Child workflows started from inside this
// activity (e.g. document_upload via create_application) then deadlock with
// SQLITE_BUSY when they try to record their own history events.
var executeChatActivity = romancy.DefineActivity(
	"execute_chat",
	func(ctx context.Context, input chatExecutionInput) (chatExecutionResult, error) {
		server := chatExecutionServer(input.AppID)
		if server == nil {
			return chatExecutionResult{}, fmt.Errorf("chat execution server is not initialized")
		}
		text, err := server.persistAndStreamAssistantChat(
			ctx,
			input.ChatID,
			input.Model,
			input.ApplicationID,
			input.TabularReviewID,
			input.Messages,
			input.DisplayedDoc,
			input.AttachedDocuments,
			input.UserMessageID,
			input.AssistantMessageID,
			func(map[string]any) error { return nil },
		)
		if err != nil {
			return chatExecutionResult{}, err
		}
		return chatExecutionResult{ChatID: input.ChatID, Text: text}, nil
	},
	romancy.WithTransactional[chatExecutionInput, chatExecutionResult](false),
)

func (s *Server) registerChatExecutionWorkflow() {
	registerChatExecutionServer(s.app.DataDir, s)
	workflow := romancy.DefineWorkflow(
		chatExecutionWorkflowName,
		func(ctx *romancy.WorkflowContext, input chatExecutionInput) (chatExecutionResult, error) {
			input.AppID = s.app.DataDir
			return executeChatActivity.Execute(ctx, input, romancy.WithActivityID("execute_chat_"+input.ChatID))
		},
	)
	s.chatRunWorkflow = workflow
	romancy.RegisterWorkflow[chatExecutionInput, chatExecutionResult](s.app.Romancy, workflow)
}

func registerChatExecutionServer(appID string, server *Server) {
	chatExecutionServers.Lock()
	defer chatExecutionServers.Unlock()
	chatExecutionServers.byAppID[appID] = server
}

func chatExecutionServer(appID string) *Server {
	chatExecutionServers.Lock()
	defer chatExecutionServers.Unlock()
	return chatExecutionServers.byAppID[appID]
}

func (s *Server) streamChatExecutionWorkflow(ctx context.Context, send func(map[string]any) error, input chatExecutionInput) error {
	ctx, span := startLocalSpan(ctx, "chat.workflow.start",
		attribute.String("workflow.name", chatExecutionWorkflowName),
		attribute.String("chat.id", input.ChatID),
		attribute.String("assistant.model", modelOrDefault(input.Model)),
		attribute.Int("chat.request_message_count", len(input.Messages)),
		attribute.Int("chat.attached_document_count", len(input.AttachedDocuments)),
		attribute.Bool("chat.has_displayed_doc", input.DisplayedDoc != nil),
	)
	defer span.End()
	instanceID := "chat_" + newID("run") + "_" + input.ChatID
	input.AppID = s.app.DataDir
	input.UserMessageID = newID("chatmsg")
	input.AssistantMessageID = newID("chatmsg")
	span.SetAttributes(
		attribute.String("workflow.instance_id", instanceID),
		attribute.String("chat.user_message_id", input.UserMessageID),
		attribute.String("chat.assistant_message_id", input.AssistantMessageID),
	)
	if input.ApplicationID != nil {
		span.SetAttributes(attribute.String("application.id", *input.ApplicationID))
	}
	if _, err := romancy.StartWorkflow(context.WithoutCancel(ctx), s.app.Romancy, s.chatRunWorkflow, input, romancy.WithInstanceID(instanceID)); err != nil {
		recordSpanError(span, err)
		return err
	}
	if err := send(map[string]any{"type": "chat_id", "chat_id": input.ChatID}); err != nil {
		recordSpanError(span, err)
		return err
	}
	return s.streamChatExecutionEvents(ctx, instanceID, input.ChatID, send)
}

func (s *Server) streamChatExecutionEvents(ctx context.Context, instanceID, chatID string, send func(map[string]any) error) error {
	ctx, span := startLocalSpan(ctx, "chat.workflow.follow",
		attribute.String("workflow.name", chatExecutionWorkflowName),
		attribute.String("workflow.instance_id", instanceID),
		attribute.String("chat.id", chatID),
	)
	defer span.End()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	sent := map[int]string{}
	pollCount := 0
	for {
		pollCount++
		if err := s.sendNewChatExecutionEvents(ctx, chatID, sent, send); err != nil {
			recordSpanError(span, err)
			return err
		}
		result, err := romancy.GetWorkflowResult[chatExecutionResult](context.WithoutCancel(ctx), s.app.Romancy, instanceID)
		if err != nil {
			recordSpanError(span, err)
			return err
		}
		span.SetAttributes(
			attribute.String("workflow.status", result.Status),
			attribute.Int("workflow.poll_count", pollCount),
			attribute.Int("sse.replayed_timeline_slots", len(sent)),
		)
		switch result.Status {
		case "completed":
			if err := s.sendNewChatExecutionEvents(ctx, chatID, sent, send); err != nil {
				recordSpanError(span, err)
				return err
			}
			if !sentTimelineContent(sent) && result.Output.Text != "" {
				if err := send(map[string]any{"type": "content_delta", "text": result.Output.Text}); err != nil {
					recordSpanError(span, err)
					return err
				}
			}
			citations := s.latestAssistantCitations(context.WithoutCancel(ctx), chatID)
			if err := send(map[string]any{"type": "citations", "citations": citations}); err != nil {
				recordSpanError(span, err)
				return err
			}
			if err := send(map[string]any{"type": "done"}); err != nil {
				recordSpanError(span, err)
				return err
			}
			span.SetAttributes(
				attribute.String("workflow.final_status", "completed"),
				attribute.Int("assistant.visible_response_chars", len(result.Output.Text)),
				attribute.Int("assistant.citation_count", len(citations)),
			)
			return nil
		case "failed":
			span.SetAttributes(attribute.String("workflow.final_status", "failed"))
			if result.Error != nil {
				recordSpanError(span, result.Error)
				return result.Error
			}
			err := errors.New("chat execution failed")
			recordSpanError(span, err)
			return err
		}
		select {
		case <-ctx.Done():
			span.SetAttributes(attribute.Bool("sse.client_disconnected", true))
			return nil
		case <-ticker.C:
		}
	}
}

func (s *Server) sendNewChatExecutionEvents(ctx context.Context, chatID string, sent map[int]string, send func(map[string]any) error) error {
	ctx, span := startLocalSpan(ctx, "chat.workflow.replay_events",
		attribute.String("workflow.name", chatExecutionWorkflowName),
		attribute.String("chat.id", chatID),
		attribute.Int("sse.sent_slot_count", len(sent)),
	)
	defer span.End()
	events, err := s.latestAssistantEvents(context.WithoutCancel(ctx), chatID)
	if err != nil {
		recordSpanError(span, err)
		span.SetAttributes(attribute.Bool("sse.replay_error_sent", true))
		_ = send(map[string]any{
			"type":    "replay_error",
			"message": "Could not reload the assistant's thinking trace for this chat.",
		})
		return nil
	}
	replayed := 0
	for i, event := range events {
		encoded, _ := json.Marshal(event)
		if sent[i] == string(encoded) {
			continue
		}
		payloads := replayPayloadsFor(event, sent[i])
		for _, payload := range payloads {
			span.AddEvent("chat.workflow.replay_event", trace.WithAttributes(traceEventAttrs(i, event, payload)...))
			if err := send(payload); err != nil {
				recordSpanError(span, err)
				return err
			}
			replayed++
		}
		sent[i] = string(encoded)
	}
	span.SetAttributes(
		attribute.Int("assistant.timeline_event_count", len(events)),
		attribute.Int("sse.replayed_event_count", replayed),
	)
	return nil
}

func (s *Server) latestAssistantEvents(ctx context.Context, chatID string) ([]map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, surrealSelect{
		Fields:  []string{"content"},
		From:    "chat_messages",
		Where:   "chat_id = " + recordID("chats", chatID) + " AND role = " + surrealString("assistant"),
		OrderBy: []string{"created_at"},
	}.String())
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	items, ok := rows[len(rows)-1]["content"].([]any)
	if !ok {
		return nil, nil
	}
	events := make([]map[string]any, 0, len(items))
	for _, item := range items {
		event, ok := item.(map[string]any)
		if ok {
			events = append(events, event)
		}
	}
	return events, nil
}

func (s *Server) latestAssistantCitations(ctx context.Context, chatID string) []map[string]any {
	rows, err := queryRows(ctx, s.app.DB, surrealSelect{
		Fields:  []string{"annotations"},
		From:    "chat_messages",
		Where:   "chat_id = " + recordID("chats", chatID) + " AND role = " + surrealString("assistant"),
		OrderBy: []string{"created_at"},
	}.String())
	if err != nil || len(rows) == 0 {
		return []map[string]any{}
	}
	items, ok := rows[len(rows)-1]["annotations"].([]any)
	if !ok {
		return []map[string]any{}
	}
	citations := []map[string]any{}
	for _, item := range items {
		annotation, ok := item.(map[string]any)
		if ok && asString(annotation["type"]) == "citation_data" {
			citations = append(citations, annotation)
		}
	}
	return citations
}

// replayPayloadsFor decides which SSE events to emit for a timeline slot
// whose persisted JSON has changed since the previous send. For reasoning
// it sends only the new suffix (true delta) and withholds reasoning_block_end
// while isStreaming is still true, so the UI keeps a single growing block
// instead of finalizing one per poll. All other event types fall back to
// timelineEventToSSE.
func replayPayloadsFor(event map[string]any, previousEncoded string) []map[string]any {
	if asString(event["type"]) != "reasoning" {
		return timelineEventToSSE(event)
	}
	curText := asString(event["text"])
	prevText := ""
	if previousEncoded != "" {
		var prev map[string]any
		if err := json.Unmarshal([]byte(previousEncoded), &prev); err == nil {
			prevText = asString(prev["text"])
		}
	}
	var payloads []map[string]any
	switch {
	case curText == prevText:
		// No new text — only the streaming flag may have flipped.
	case strings.HasPrefix(curText, prevText):
		suffix := curText[len(prevText):]
		if suffix != "" {
			payloads = append(payloads, map[string]any{"type": "reasoning_delta", "text": suffix})
		}
	default:
		// Divergent rewrite (rare); send full text and let the UI's streaming
		// reasoning block coalesce.
		payloads = append(payloads, map[string]any{"type": "reasoning_delta", "text": curText})
	}
	if !asBool(event["isStreaming"]) {
		payloads = append(payloads, map[string]any{"type": "reasoning_block_end"})
	}
	return payloads
}

func timelineEventToSSE(event map[string]any) []map[string]any {
	eventType := asString(event["type"])
	switch eventType {
	case "thinking":
		return []map[string]any{{"type": "thinking"}}
	case "reasoning":
		text := asString(event["text"])
		if text == "" {
			return nil
		}
		return []map[string]any{
			{"type": "reasoning_delta", "text": text},
			{"type": "reasoning_block_end"},
		}
	case "content":
		return []map[string]any{{"type": "content_delta", "text": asString(event["text"])}}
	case "doc_read":
		if asBool(event["isStreaming"]) {
			return []map[string]any{{"type": "doc_read_start", "filename": event["filename"], "document_id": event["document_id"]}}
		}
		return []map[string]any{{"type": "doc_read", "filename": event["filename"], "document_id": event["document_id"]}}
	case "doc_find":
		if asBool(event["isStreaming"]) {
			return []map[string]any{{"type": "doc_find_start", "filename": event["filename"], "document_id": event["document_id"], "query": event["query"]}}
		}
		return []map[string]any{{"type": "doc_find", "filename": event["filename"], "document_id": event["document_id"], "query": event["query"], "total_matches": event["total_matches"]}}
	case "doc_created":
		if asBool(event["isStreaming"]) {
			return []map[string]any{{"type": "doc_created_start", "filename": event["filename"]}}
		}
	case "doc_replicated":
		if asBool(event["isStreaming"]) {
			return []map[string]any{{"type": "doc_replicate_start", "filename": event["filename"], "count": event["count"]}}
		}
	case "doc_edited":
		if asBool(event["isStreaming"]) {
			return []map[string]any{{"type": "doc_edited_start", "filename": event["filename"]}}
		}
	}
	return []map[string]any{cloneMap(event)}
}

func traceEventAttrs(slot int, event, payload map[string]any) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.Int("assistant.timeline_slot", slot),
		attribute.String("assistant.timeline_event_type", asString(event["type"])),
		attribute.String("sse.event_type", asString(payload["type"])),
	}
}

func sentTimelineContent(sent map[int]string) bool {
	for _, encoded := range sent {
		var event map[string]any
		if err := json.Unmarshal([]byte(encoded), &event); err == nil && asString(event["type"]) == "content" {
			return true
		}
	}
	return false
}
