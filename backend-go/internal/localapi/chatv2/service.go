package chatv2

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/i2y/romancy"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// Deps bundles everything the chat workflow needs from the surrounding
// localapi package. Passed in by NewService so the chatv2 package stays
// import-cycle-free with no package-level globals.
type Deps struct {
	// LLMCompletion runs one completion turn against the configured model and
	// streams deltas via the onContentDelta / onThinkingDelta callbacks. The
	// caller is responsible for OTel-spanning the actual HTTP call; this
	// service spans the activity envelope.
	LLMCompletion func(
		ctx context.Context,
		in LLMTurnInput,
		onContentDelta func(string),
		onThinkingDelta func(string),
	) (LLMTurnResult, error)

	// PersistAssistantMessage writes the final assistant message to Surreal.
	// Content is the timeline ([]map[string]any) we want stored on the row.
	PersistAssistantMessage func(ctx context.Context, in PersistMessageInput) error

	// DispatchTool runs a single tool call. onProgress lets pure-compute
	// tools and side-effecting tools emit tool_progress events without
	// reaching into the bus directly. ResultJSON is the JSON-encoded tool
	// result that the workflow appends to the next LLM turn's messages.
	DispatchTool func(
		ctx context.Context,
		in ToolDispatchInput,
		onProgress func(payload map[string]any),
	) (ToolDispatchResult, error)

	// OllamaToolSchemas returns the per-tool function schemas Ollama needs
	// to know what's callable in this conversation. Returned slice is
	// expected to be safe to share (cached, immutable).
	OllamaToolSchemas []map[string]any

	// LoadHistory returns prior chat_messages for the given chat_id as
	// already-flattened Ollama-shaped messages (user / assistant / tool).
	// The handler persists the latest user message BEFORE starting the
	// workflow, so the loaded slice already includes it — the workflow
	// body must NOT append in.UserMessage again.
	LoadHistory func(ctx context.Context, chatID string) ([]map[string]any, error)
}

// ToolDispatchInput is the activity input for one tool call.
type ToolDispatchInput struct {
	ChatID        string  `json:"chat_id"`
	ApplicationID *string `json:"application_id,omitempty"`
	Turn          int     `json:"turn"`
	ToolCallID    string  `json:"tool_call_id"`
	// OllamaName is the underscored name Ollama uses on the wire (e.g.
	// "career_context__create_company"). The wire side maps it back to the
	// canonical tools.Ident.
	OllamaName string          `json:"ollama_name"`
	Arguments  json.RawMessage `json:"arguments"`
}

// ToolDispatchResult carries the tool's JSON-encoded result back to the
// workflow body, which appends it as a "tool" role message for the next
// LLM turn. The summary is a short human-readable string for the
// tool_completed event (e.g. "company_id=...").
type ToolDispatchResult struct {
	// CanonicalName is the tools.Ident form (e.g. "career_context.create_company").
	CanonicalName string          `json:"canonical_name"`
	ResultJSON    json.RawMessage `json:"result_json"`
	Summary       map[string]any  `json:"summary,omitempty"`
	Error         string          `json:"error,omitempty"`
}

// LLMTurnInput is the activity input for a single LLM completion turn.
type LLMTurnInput struct {
	ChatID             string `json:"chat_id"`
	AssistantMessageID string `json:"assistant_message_id"`
	Turn               int    `json:"turn"`
	Model              string `json:"model"`
	// ApplicationID, when non-nil, tells LLMCompletion this chat lives
	// inside an application context — the wire layer injects an
	// application-context system message (current application id + the
	// list of its documents) so the agent doesn't have to ask the user
	// "which job" or "which document".
	ApplicationID *string `json:"application_id,omitempty"`
	// Messages is the conversation context for this turn in Ollama-message
	// shape. Kept opaque ([]map[string]any) so chatv2 doesn't depend on the
	// concrete llm.go types.
	Messages []map[string]any `json:"messages"`
	// Tools are the Ollama-shaped function schemas (cached in Deps).
	Tools []map[string]any `json:"tools,omitempty"`
}

// LLMTurnResult is the activity output of one completion turn.
type LLMTurnResult struct {
	Content   string        `json:"content"`
	Thinking  string        `json:"thinking"`
	ToolCalls []LLMToolCall `json:"tool_calls,omitempty"`
}

// LLMToolCall is one tool call emitted by the model in a completion turn.
type LLMToolCall struct {
	OllamaName string          `json:"ollama_name"`
	Arguments  json.RawMessage `json:"arguments"`
}

// PersistMessageInput is the activity input for persisting an assistant
// message. Content is the timeline JSON we want stored.
type PersistMessageInput struct {
	ChatID    string           `json:"chat_id"`
	MessageID string           `json:"message_id"`
	Content   []map[string]any `json:"content"`
}

// Input is the workflow input.
type Input struct {
	ChatID             string  `json:"chat_id"`
	ApplicationID      *string `json:"application_id,omitempty"`
	UserMessage        string  `json:"user_message"`
	UserMessageID      string  `json:"user_message_id"`
	AssistantMessageID string  `json:"assistant_message_id"`
	Model              string  `json:"model"`
}

// Result is the workflow output.
type Result struct {
	ChatID string `json:"chat_id"`
	Final  string `json:"final"`
	Turns  int    `json:"turns"`
}

// Service owns the workflow definition, the activity definitions, and the
// per-chat broadcaster registry. The activities close over the service so
// they can access deps and the registry without globals.
type Service struct {
	Registry    *Registry
	Deps        Deps
	tracer      trace.Tracer
	workflow    *romancy.WorkflowFunc[Input, Result]
	llmAct      *romancy.Activity[LLMTurnInput, LLMTurnResult]
	persistAct  *romancy.Activity[PersistMessageInput, persistResult]
	dispatchAct *romancy.Activity[ToolDispatchInput, ToolDispatchResult]
}

// MaxTurns is the safety cap on agent loop iterations. Most chats complete
// in 1–3 turns; this just keeps a model that hallucinates infinite tool
// calls from running forever.
const MaxTurns = 12

// persistResult is the empty activity result for persistence — we only care
// about success/failure, but romancy activities need a concrete output type.
type persistResult struct{}

// NewService constructs the service with its deps. RegisterRomancy must be
// called next to define and register the workflow + activities.
func NewService(reg *Registry, deps Deps) *Service {
	return &Service{
		Registry: reg,
		Deps:     deps,
		tracer:   otel.Tracer("luke/localapi/chatv2"),
	}
}

// RegisterRomancy defines the chatv2 workflow + activities on the romancy
// app. Idempotent per app instance; calling twice is a bug because romancy
// rejects duplicate registrations.
func (s *Service) RegisterRomancy(app *romancy.App) {
	s.persistAct = romancy.DefineActivity(
		"chatv2.persist_assistant_message",
		func(ctx context.Context, in PersistMessageInput) (persistResult, error) {
			ctx, span := s.tracer.Start(ctx, "chatv2.activity.persist_assistant_message")
			defer span.End()
			span.SetAttributes(
				attribute.String("chat.id", in.ChatID),
				attribute.String("chat.message_id", in.MessageID),
				attribute.Int("chat.timeline_event_count", len(in.Content)),
			)
			if err := s.Deps.PersistAssistantMessage(ctx, in); err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
				return persistResult{}, err
			}
			return persistResult{}, nil
		},
	)
	s.llmAct = romancy.DefineActivity(
		"chatv2.llm_completion_turn",
		func(ctx context.Context, in LLMTurnInput) (LLMTurnResult, error) {
			ctx, span := s.tracer.Start(ctx, "chatv2.activity.llm_completion_turn")
			defer span.End()
			span.SetAttributes(
				attribute.String("chat.id", in.ChatID),
				attribute.Int("chat.turn", in.Turn),
				attribute.String("assistant.model", in.Model),
				attribute.Int("llm.input_message_count", len(in.Messages)),
			)
			bus := s.Registry.Get(in.ChatID)
			onContent := func(delta string) {
				if delta == "" || bus == nil {
					return
				}
				bus.Publish(NewEvent(EventContentDelta, map[string]any{
					"turn": in.Turn,
					"text": delta,
				}))
			}
			onThinking := func(delta string) {
				if delta == "" || bus == nil {
					return
				}
				bus.Publish(NewEvent(EventReasoningDelta, map[string]any{
					"turn": in.Turn,
					"text": delta,
				}))
			}
			result, err := s.Deps.LLMCompletion(ctx, in, onContent, onThinking)
			if err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
				return LLMTurnResult{}, err
			}
			span.SetAttributes(
				attribute.Int("llm.response_chars", len(result.Content)),
				attribute.Int("llm.thinking_chars", len(result.Thinking)),
				attribute.Int("llm.tool_call_count", len(result.ToolCalls)),
			)
			if bus != nil && result.Thinking != "" {
				bus.Publish(NewEvent(EventReasoningBlockEnd, map[string]any{"turn": in.Turn}))
			}
			if bus != nil && result.Content != "" {
				bus.Publish(NewEvent(EventContentDone, map[string]any{"turn": in.Turn}))
			}
			return result, nil
		},
		romancy.WithTransactional[LLMTurnInput, LLMTurnResult](false),
	)

	s.dispatchAct = romancy.DefineActivity(
		"chatv2.dispatch_tool",
		func(ctx context.Context, in ToolDispatchInput) (ToolDispatchResult, error) {
			ctx, span := s.tracer.Start(ctx, "chatv2.activity.dispatch_tool")
			defer span.End()
			span.SetAttributes(
				attribute.String("chat.id", in.ChatID),
				attribute.Int("chat.turn", in.Turn),
				attribute.String("tool.ollama_name", in.OllamaName),
				attribute.String("tool.call_id", in.ToolCallID),
			)
			bus := s.Registry.Get(in.ChatID)
			onProgress := func(payload map[string]any) {
				if bus == nil || payload == nil {
					return
				}
				payload["turn"] = in.Turn
				payload["tool_call_id"] = in.ToolCallID
				bus.Publish(NewEvent(EventToolProgress, payload))
			}
			result, err := s.Deps.DispatchTool(ctx, in, onProgress)
			if err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
				return ToolDispatchResult{}, err
			}
			if result.Error != "" {
				span.SetAttributes(attribute.String("tool.error", result.Error))
			}
			span.SetAttributes(attribute.String("tool.canonical_name", result.CanonicalName))
			return result, nil
		},
	)

	s.workflow = romancy.DefineWorkflow(
		"chatv2_chat_execution",
		func(ctx *romancy.WorkflowContext, in Input) (Result, error) {
			// The workflow body itself gets its own span so per-turn pacing
			// is direct rather than inferred from gaps between activities.
			// Parent context is the workflow goroutine's; activities below
			// will nest under their own spans regardless.
			bodyCtx, bodySpan := s.tracer.Start(ctx.Context(), "chatv2.workflow.body")
			defer bodySpan.End()
			bodySpan.SetAttributes(
				attribute.String("chat.id", in.ChatID),
				attribute.String("chat.assistant_message_id", in.AssistantMessageID),
				attribute.String("assistant.model", in.Model),
				attribute.Bool("chat.application_scoped", in.ApplicationID != nil),
				attribute.Int("chatv2.max_turns", MaxTurns),
			)
			_ = bodyCtx // body's own ctx — not threaded into activities (they go through romancy)
			bodyStart := time.Now()

			bus := s.Registry.Get(in.ChatID)
			publishCount := 0
			publish := func(t EventType, payload map[string]any) {
				if bus != nil {
					bus.Publish(NewEvent(t, payload))
					publishCount++
				}
			}
			publish(EventChatStarted, map[string]any{
				"chat_id":    in.ChatID,
				"turn_count": 0,
			})
			// Rehydrate prior conversation so the LLM has full context.
			// The handler persists the latest user message before starting
			// the workflow, so the loaded slice already includes it; do not
			// append in.UserMessage on top of that.
			messages, loadErr := s.Deps.LoadHistory(ctx.Context(), in.ChatID)
			if loadErr != nil {
				publish(EventBackendError, map[string]any{"message": loadErr.Error()})
				publish(EventChatCompleted, map[string]any{"reason": "error"})
				finalizeBodySpan(bodySpan, bodyStart, "load_history_failed", 0, 0, 0, 0, publishCount, loadErr)
				return Result{}, loadErr
			}
			if len(messages) == 0 {
				// Defensive fallback: handler should have persisted the
				// user message before us, but if for any reason it didn't,
				// still send the new prompt rather than hitting the LLM
				// with an empty conversation.
				messages = []map[string]any{
					{"role": "user", "content": in.UserMessage},
				}
			}
			timeline := []map[string]any{}
			reason := "done"
			finalText := ""
			totalToolCalls := 0
			totalReasoningChars := 0
			totalContentChars := 0
			turn := 1
			for ; turn <= MaxTurns; turn++ {
				turnStart := time.Now()
				bodySpan.AddEvent("chatv2.workflow.turn_started", trace.WithAttributes(
					attribute.Int("turn", turn),
				))
				publish(EventTurnStarted, map[string]any{"turn": turn})
				llmIn := LLMTurnInput{
					ChatID:             in.ChatID,
					AssistantMessageID: in.AssistantMessageID,
					Turn:               turn,
					Model:              in.Model,
					ApplicationID:      in.ApplicationID,
					Messages:           messages,
					Tools:              s.Deps.OllamaToolSchemas,
				}
				llmOut, err := s.llmAct.Execute(ctx, llmIn, romancy.WithActivityID(fmt.Sprintf("chatv2_llm_%s_%d", in.ChatID, turn)))
				if err != nil {
					publish(EventBackendError, map[string]any{"message": err.Error()})
					publish(EventChatCompleted, map[string]any{"reason": "error"})
					finalizeBodySpan(bodySpan, bodyStart, "llm_failed", turn-1, totalToolCalls, totalReasoningChars, totalContentChars, publishCount, err)
					return Result{}, err
				}
				if llmOut.Thinking != "" {
					timeline = append(timeline, map[string]any{"type": "reasoning", "text": llmOut.Thinking, "turn": turn})
					totalReasoningChars += len(llmOut.Thinking)
				}
				if llmOut.Content != "" {
					timeline = append(timeline, map[string]any{"type": "content", "text": llmOut.Content, "turn": turn})
					finalText = llmOut.Content
					totalContentChars += len(llmOut.Content)
				}
				bodySpan.AddEvent("chatv2.workflow.llm_turn_completed", trace.WithAttributes(
					attribute.Int("turn", turn),
					attribute.Int("llm.reasoning_chars", len(llmOut.Thinking)),
					attribute.Int("llm.content_chars", len(llmOut.Content)),
					attribute.Int("llm.tool_call_count", len(llmOut.ToolCalls)),
					attribute.Float64("turn.llm_ms", float64(time.Since(turnStart).Milliseconds())),
				))
				// Record assistant message (with tool_calls if any) back into
				// messages so the next LLM turn can see the tool_calls it
				// just emitted.
				assistantMsg := map[string]any{"role": "assistant", "content": llmOut.Content}
				if len(llmOut.ToolCalls) > 0 {
					calls := make([]map[string]any, 0, len(llmOut.ToolCalls))
					for _, tc := range llmOut.ToolCalls {
						var args any
						_ = json.Unmarshal(tc.Arguments, &args)
						calls = append(calls, map[string]any{
							"function": map[string]any{
								"name":      tc.OllamaName,
								"arguments": args,
							},
						})
					}
					assistantMsg["tool_calls"] = calls
				}
				messages = append(messages, assistantMsg)

				if len(llmOut.ToolCalls) == 0 {
					publish(EventTurnCompleted, map[string]any{"turn": turn})
					break
				}

				for _, call := range llmOut.ToolCalls {
					callID := fmt.Sprintf("toolcall_%s_%d_%s", in.ChatID, turn, call.OllamaName)
					totalToolCalls++
					toolStart := time.Now()
					publish(EventToolStarted, map[string]any{
						"turn":         turn,
						"tool_call_id": callID,
						"name":         call.OllamaName,
						"arguments":    call.Arguments,
					})
					toolOut, err := s.dispatchAct.Execute(ctx, ToolDispatchInput{
						ChatID:        in.ChatID,
						ApplicationID: in.ApplicationID,
						Turn:          turn,
						ToolCallID:    callID,
						OllamaName:    call.OllamaName,
						Arguments:     call.Arguments,
					}, romancy.WithActivityID(fmt.Sprintf("chatv2_tool_%s_%d_%s", in.ChatID, turn, call.OllamaName)))
					if err != nil {
						publish(EventToolFailed, map[string]any{
							"turn":         turn,
							"tool_call_id": callID,
							"name":         call.OllamaName,
							"error":        err.Error(),
						})
						publish(EventBackendError, map[string]any{"message": err.Error()})
						publish(EventChatCompleted, map[string]any{"reason": "error"})
						finalizeBodySpan(bodySpan, bodyStart, "tool_failed", turn-1, totalToolCalls, totalReasoningChars, totalContentChars, publishCount, err)
						return Result{}, err
					}
					timeline = append(timeline, map[string]any{
						"type":         "tool",
						"turn":         turn,
						"name":         toolOut.CanonicalName,
						"tool_call_id": callID,
						"result":       toolOut.Summary,
						"error":        toolOut.Error,
					})
					publish(EventToolCompleted, map[string]any{
						"turn":         turn,
						"tool_call_id": callID,
						"name":         toolOut.CanonicalName,
						"result":       toolOut.Summary,
						"error":        toolOut.Error,
					})
					bodySpan.AddEvent("chatv2.workflow.tool_completed", trace.WithAttributes(
						attribute.Int("turn", turn),
						attribute.String("tool.name", toolOut.CanonicalName),
						attribute.String("tool.ollama_name", call.OllamaName),
						attribute.Bool("tool.failed", toolOut.Error != ""),
						attribute.Float64("tool.duration_ms", float64(time.Since(toolStart).Milliseconds())),
					))
					messages = append(messages, map[string]any{
						"role":      "tool",
						"tool_name": call.OllamaName,
						"content":   string(toolOut.ResultJSON),
					})
				}
				bodySpan.AddEvent("chatv2.workflow.turn_completed", trace.WithAttributes(
					attribute.Int("turn", turn),
					attribute.Float64("turn.duration_ms", float64(time.Since(turnStart).Milliseconds())),
				))
				publish(EventTurnCompleted, map[string]any{"turn": turn})
			}
			if turn > MaxTurns {
				reason = "max_turns"
			}
			_, err := s.persistAct.Execute(ctx, PersistMessageInput{
				ChatID:    in.ChatID,
				MessageID: in.AssistantMessageID,
				Content:   timeline,
			}, romancy.WithActivityID(fmt.Sprintf("chatv2_persist_%s", in.ChatID)))
			if err != nil {
				publish(EventBackendError, map[string]any{"message": err.Error()})
				publish(EventChatCompleted, map[string]any{"reason": "error"})
				finalizeBodySpan(bodySpan, bodyStart, "persist_failed", turn-1, totalToolCalls, totalReasoningChars, totalContentChars, publishCount, err)
				return Result{}, err
			}
			publish(EventChatMessagePersisted, map[string]any{"message_id": in.AssistantMessageID})
			publish(EventChatCompleted, map[string]any{"reason": reason})
			finalizeBodySpan(bodySpan, bodyStart, reason, turn, totalToolCalls, totalReasoningChars, totalContentChars, publishCount, nil)
			return Result{ChatID: in.ChatID, Final: finalText, Turns: turn}, nil
		},
	)
	romancy.RegisterWorkflow[Input, Result](app, s.workflow)
}

// Workflow returns the registered workflow definition. Used by the HTTP
// handler to start invocations.
func (s *Service) Workflow() *romancy.WorkflowFunc[Input, Result] {
	return s.workflow
}

// finalizeBodySpan stamps the totals + exit reason onto the workflow body
// span. Called from every exit branch so we always know how a chat ended.
func finalizeBodySpan(
	span trace.Span,
	start time.Time,
	reason string,
	completedTurns int,
	totalToolCalls int,
	totalReasoningChars int,
	totalContentChars int,
	publishCount int,
	err error,
) {
	span.SetAttributes(
		attribute.String("chatv2.workflow.exit_reason", reason),
		attribute.Int("chatv2.workflow.completed_turns", completedTurns),
		attribute.Int("chatv2.workflow.tool_call_count", totalToolCalls),
		attribute.Int("chatv2.workflow.reasoning_chars", totalReasoningChars),
		attribute.Int("chatv2.workflow.content_chars", totalContentChars),
		attribute.Int("chatv2.workflow.bus_publish_count", publishCount),
		attribute.Float64("chatv2.workflow.duration_ms", float64(time.Since(start).Milliseconds())),
	)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
}
