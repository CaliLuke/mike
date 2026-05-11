package localapi

import "testing"

func TestSurrealSelectAutoIncludesOrderByFields(t *testing.T) {
	got := surrealSelect{
		Fields:  []string{"content"},
		From:    "chat_messages",
		Where:   "chat_id = chats:abc AND role = \"assistant\"",
		OrderBy: []string{"created_at"},
	}.String()
	want := "SELECT content, created_at FROM chat_messages WHERE chat_id = chats:abc AND role = \"assistant\" ORDER BY created_at;"
	if got != want {
		t.Fatalf("auto-include:\n got:  %s\n want: %s", got, want)
	}
}

func TestSurrealSelectDoesNotDuplicateExistingProjectionField(t *testing.T) {
	got := surrealSelect{
		Fields:  []string{"id", "created_at", "content"},
		From:    "chat_messages",
		OrderBy: []string{"created_at DESC"},
		Limit:   4,
	}.String()
	want := "SELECT id, created_at, content FROM chat_messages ORDER BY created_at DESC LIMIT 4;"
	if got != want {
		t.Fatalf("duplicate avoidance:\n got:  %s\n want: %s", got, want)
	}
}

func TestSurrealSelectRecognisesAliasedProjection(t *testing.T) {
	got := surrealSelect{
		Fields:  []string{"id", "review_id AS application_id", "user_id", "title", "created_at", "updated_at"},
		From:    "tabular_review_chats",
		Where:   "review_id = tabular_reviews:r1",
		OrderBy: []string{"updated_at DESC"},
	}.String()
	want := "SELECT id, review_id AS application_id, user_id, title, created_at, updated_at FROM tabular_review_chats WHERE review_id = tabular_reviews:r1 ORDER BY updated_at DESC;"
	if got != want {
		t.Fatalf("alias projection:\n got:  %s\n want: %s", got, want)
	}
}

func TestSurrealSelectMultipleOrderByFields(t *testing.T) {
	got := surrealSelect{
		Fields:  []string{"id", "name"},
		From:    "companies",
		OrderBy: []string{"ft_score DESC", "similarity DESC", "name"},
		Limit:   8,
	}.String()
	want := "SELECT id, name, ft_score, similarity FROM companies ORDER BY ft_score DESC, similarity DESC, name LIMIT 8;"
	if got != want {
		t.Fatalf("multi orderBy:\n got:  %s\n want: %s", got, want)
	}
}

func TestSurrealUpdateRendersSortedPairs(t *testing.T) {
	got := surrealUpdate{
		Target: "chat_messages:abc",
		Set: map[string]string{
			"content":    `"timeline json"`,
			"updated_at": "time::now()",
		},
		Where: "user_id = users:local",
	}.String()
	want := `UPDATE chat_messages:abc SET content = "timeline json", updated_at = time::now() WHERE user_id = users:local;`
	if got != want {
		t.Fatalf("update:\n got:  %s\n want: %s", got, want)
	}
}

func TestSurrealUpdateWithoutWhere(t *testing.T) {
	got := surrealUpdate{
		Target: "documents:doc1",
		Set:    map[string]string{"application_id": "applications:app1"},
	}.String()
	want := "UPDATE documents:doc1 SET application_id = applications:app1;"
	if got != want {
		t.Fatalf("update no-where:\n got:  %s\n want: %s", got, want)
	}
}

func TestSurrealCreateRendersSortedContent(t *testing.T) {
	got := surrealCreate{
		RecordID: "companies:co1",
		Content: map[string]string{
			"name":       `"Acme"`,
			"created_at": "time::now()",
		},
	}.String()
	want := `CREATE companies:co1 CONTENT { created_at: time::now(), name: "Acme" };`
	if got != want {
		t.Fatalf("create:\n got:  %s\n want: %s", got, want)
	}
}
