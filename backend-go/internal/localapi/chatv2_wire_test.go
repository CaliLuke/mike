package localapi

import (
	"encoding/json"
	"reflect"
	"testing"
)

// TestFlattenAssistantTimelineProjectsContentAndTools guards the chatv2
// history rehydration: the persisted V2 timeline ([]event with reasoning/
// content/tool entries) must collapse back into one assistant text body
// plus a `role:"tool"` message per tool event, in original order.
// Reasoning events are intentionally dropped — they're internal scratchpad,
// not part of the next turn's context.
func TestFlattenAssistantTimelineProjectsContentAndTools(t *testing.T) {
	timeline := []any{
		map[string]any{"type": "reasoning", "turn": 1.0, "text": "thinking..."},
		map[string]any{
			"type":         "tool",
			"turn":         1.0,
			"name":         "career_context.fetch_web_page",
			"tool_call_id": "tc1",
			"result":       map[string]any{"title": "Senior PM", "url": "https://example.com"},
			"error":        "",
		},
		map[string]any{"type": "reasoning", "turn": 2.0, "text": "more thinking..."},
		map[string]any{"type": "content", "turn": 2.0, "text": "Hello! "},
		map[string]any{"type": "content", "turn": 2.0, "text": "Anything else?"},
	}

	gotText, gotTools := flattenAssistantTimeline(timeline)
	wantText := "Hello! Anything else?"
	if gotText != wantText {
		t.Fatalf("text body:\n got:  %q\n want: %q", gotText, wantText)
	}
	if len(gotTools) != 1 {
		t.Fatalf("expected 1 tool message, got %d (%#v)", len(gotTools), gotTools)
	}
	if got := gotTools[0]["role"]; got != "tool" {
		t.Fatalf("tool role = %v, want \"tool\"", got)
	}
	if got := gotTools[0]["tool_name"]; got != "career_context.fetch_web_page" {
		t.Fatalf("tool_name = %v", got)
	}
	// Result should be JSON-encoded.
	var decoded map[string]any
	if err := json.Unmarshal([]byte(gotTools[0]["content"].(string)), &decoded); err != nil {
		t.Fatalf("tool content not valid JSON: %v (raw=%q)", err, gotTools[0]["content"])
	}
	if decoded["title"] != "Senior PM" {
		t.Fatalf("tool content lost result fields: %#v", decoded)
	}
}

func TestFlattenAssistantTimelineEmitsErrorForFailedTool(t *testing.T) {
	timeline := []any{
		map[string]any{
			"type":  "tool",
			"name":  "career_context.create_application",
			"error": "name is required",
		},
	}
	_, tools := flattenAssistantTimeline(timeline)
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool message")
	}
	if got := tools[0]["content"]; !reflect.DeepEqual(got, `{"error":"name is required"}`) {
		t.Fatalf("failed-tool content: got %v", got)
	}
}

func TestFlattenUserContentHandlesPlainString(t *testing.T) {
	got := flattenUserContent("hello there")
	if got != "hello there" {
		t.Fatalf("plain string: got %q", got)
	}
}
