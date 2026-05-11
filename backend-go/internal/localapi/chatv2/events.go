// Package chatv2 implements the durable workflow-driven chat agent loop.
// See /Users/luca/.claude/plans/yeah-sounds-more-reasonable-shimmering-sunrise.md.
//
// V2 routes a chat session through a romancy workflow whose body owns the
// agent loop. Each LLM completion turn and each side-effecting tool dispatch
// is its own activity, which gives per-turn durability and clean replay on
// reconnect. SSE events flow through an in-process broadcaster (eventbus.go)
// rather than being polled out of Surreal.
package chatv2

// EventType is the discriminant of an SSE event the workflow emits.
type EventType string

const (
	EventChatStarted          EventType = "chat_started"
	EventTurnStarted          EventType = "turn_started"
	EventTurnCompleted        EventType = "turn_completed"
	EventReasoningDelta       EventType = "reasoning_delta"
	EventReasoningBlockEnd    EventType = "reasoning_block_end"
	EventContentDelta         EventType = "content_delta"
	EventContentDone          EventType = "content_done"
	EventToolStarted          EventType = "tool_started"
	EventToolProgress         EventType = "tool_progress"
	EventToolCompleted        EventType = "tool_completed"
	EventToolFailed           EventType = "tool_failed"
	EventCitations            EventType = "citations"
	EventChatMessagePersisted EventType = "chat_message_persisted"
	EventChatCompleted        EventType = "chat_completed"
	EventBackendError         EventType = "backend_error"
)

// Event is the envelope every broadcaster subscriber receives. Payload is the
// wire shape forwarded to SSE clients as the `data` field. Type duplicates
// Payload["type"] for fast dispatch on the subscriber side without parsing
// the map.
type Event struct {
	Type    EventType
	Payload map[string]any
}

// NewEvent builds an Event with Type and Payload's "type" key kept in sync.
func NewEvent(t EventType, payload map[string]any) Event {
	if payload == nil {
		payload = map[string]any{}
	}
	payload["type"] = string(t)
	return Event{Type: t, Payload: payload}
}
