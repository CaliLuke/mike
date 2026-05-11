package localapi

import (
	"context"
	"testing"

	"github.com/CaliLuke/luke/backend-go/internal/localdata"
)

// TestChatReplayQueriesParseAgainstSurrealDB exercises the chat-replay path
// against a real SurrealDB so SurrealQL parse errors (e.g. ORDER BY field
// missing from SELECT) fail fast in CI rather than as silent runtime errors
// that look like "no thinking trace" to the user.
func TestChatReplayQueriesParseAgainstSurrealDB(t *testing.T) {
	app, err := localdata.Open(context.Background(), localdata.Options{
		DataDir:          t.TempDir(),
		LocalStorageRoot: t.TempDir(),
		WorkerID:         "chat-replay-test",
	})
	if err != nil {
		t.Fatalf("open localdata app: %v", err)
	}
	defer func() {
		if closeErr := app.Close(context.Background()); closeErr != nil {
			t.Fatalf("close localdata app: %v", closeErr)
		}
	}()

	server := &Server{app: app}
	ctx := context.Background()

	chat, err := server.createChat(ctx, nil)
	if err != nil {
		t.Fatalf("create chat: %v", err)
	}
	chatID := asString(chat["id"])
	if chatID == "" {
		t.Fatalf("createChat returned no id: %#v", chat)
	}

	// Persist a structured assistant message — content is the event timeline
	// the replay path needs to fetch back. Include annotations to exercise
	// the citation query too.
	content := []map[string]any{
		{"type": "reasoning", "text": "thinking step one"},
		{"type": "content", "text": "final answer"},
	}
	annotations := []map[string]any{
		{"type": "citation_data", "url": "https://example.com"},
	}
	messageID := newID("msg")
	if err = server.createChatMessageWithID(ctx, messageID, chatID, "assistant", content, nil, annotations); err != nil {
		t.Fatalf("persist assistant message: %v", err)
	}

	events, err := server.latestAssistantEvents(ctx, chatID)
	if err != nil {
		t.Fatalf("latestAssistantEvents: %v", err)
	}
	if len(events) != len(content) {
		t.Fatalf("latestAssistantEvents returned %d events, want %d (events=%#v)", len(events), len(content), events)
	}
	if got := asString(events[0]["type"]); got != "reasoning" {
		t.Fatalf("first event type = %q, want reasoning (events=%#v)", got, events)
	}

	citations := server.latestAssistantCitations(ctx, chatID)
	if len(citations) != 1 {
		t.Fatalf("latestAssistantCitations returned %d, want 1 (citations=%#v)", len(citations), citations)
	}
	if got := asString(citations[0]["type"]); got != "citation_data" {
		t.Fatalf("citation type = %q, want citation_data", got)
	}

	// priorAssistantEventHint just must not panic / error against SurrealDB.
	// Empty-string output is acceptable; the contract is "don't crash".
	_ = server.priorAssistantEventHint(ctx, chatID)
}
