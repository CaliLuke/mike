package localapi

import (
	"encoding/json"
	"reflect"
	"testing"
)

// TestReplayPayloadsForStreamingReasoningEmitsSuffixOnly guards against the
// regression where every replay tick re-emitted the full accumulated reasoning
// text plus a reasoning_block_end, causing the UI to render a fresh "thinking"
// block on every poll instead of one growing block.
func TestReplayPayloadsForStreamingReasoningEmitsSuffixOnly(t *testing.T) {
	prevEvent := map[string]any{"type": "reasoning", "text": "I think", "isStreaming": true}
	prevEncoded, _ := json.Marshal(prevEvent)
	curEvent := map[string]any{"type": "reasoning", "text": "I think this is more", "isStreaming": true}

	got := replayPayloadsFor(curEvent, string(prevEncoded))
	want := []map[string]any{
		{"type": "reasoning_delta", "text": " this is more"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("streaming reasoning replay:\n got:  %#v\n want: %#v", got, want)
	}
}

func TestReplayPayloadsForCompletedReasoningEmitsBlockEnd(t *testing.T) {
	prevEvent := map[string]any{"type": "reasoning", "text": "I think this is more", "isStreaming": true}
	prevEncoded, _ := json.Marshal(prevEvent)
	curEvent := map[string]any{"type": "reasoning", "text": "I think this is more", "isStreaming": false}

	got := replayPayloadsFor(curEvent, string(prevEncoded))
	want := []map[string]any{
		{"type": "reasoning_block_end"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("completion replay:\n got:  %#v\n want: %#v", got, want)
	}
}

func TestReplayPayloadsForFirstEmitSendsFullText(t *testing.T) {
	curEvent := map[string]any{"type": "reasoning", "text": "first thought", "isStreaming": true}

	got := replayPayloadsFor(curEvent, "")
	want := []map[string]any{
		{"type": "reasoning_delta", "text": "first thought"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("first emit:\n got:  %#v\n want: %#v", got, want)
	}
}

func TestReplayPayloadsForNonReasoningFallsBack(t *testing.T) {
	curEvent := map[string]any{"type": "content", "text": "final"}
	got := replayPayloadsFor(curEvent, "")
	want := []map[string]any{{"type": "content_delta", "text": "final"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("non-reasoning passthrough:\n got:  %#v\n want: %#v", got, want)
	}
}
