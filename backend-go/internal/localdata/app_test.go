package localdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/i2y/romancy"

	"github.com/CaliLuke/luke/backend-go/internal/persistence"
)

func TestOpenCreatesLocalDataStoresAndSeedsUser(t *testing.T) {
	app := openTestApp(t)
	dataDir := app.DataDir
	defer closeTestApp(t, app)

	if Namespace != "luke" || Database != "luke" {
		t.Fatalf("namespace/database = %q/%q, want luke/luke", Namespace, Database)
	}
	if app.SurrealKVDir != filepath.Join(dataDir, SurrealKVDirName) {
		t.Fatalf("surrealkv dir = %q, want under data dir", app.SurrealKVDir)
	}
	if app.RomancyDBPath != filepath.Join(dataDir, RomancyDBName) {
		t.Fatalf("romancy db = %q, want under data dir", app.RomancyDBPath)
	}
	if app.LocalStorageRoot != filepath.Join(dataDir, LocalStorageDir) {
		t.Fatalf("local storage root = %q, want under data dir", app.LocalStorageRoot)
	}
	if _, err := os.Stat(app.RomancyDBPath); err != nil {
		t.Fatalf("romancy db was not created: %v", err)
	}
	if info, err := os.Stat(app.LocalStorageRoot); err != nil {
		t.Fatalf("local storage root was not created: %v", err)
	} else if !info.IsDir() {
		t.Fatalf("local storage root is not a directory: %s", app.LocalStorageRoot)
	}

	userRows := queryRows(t, app.DB, "SELECT email FROM users:local;")
	if len(userRows) != 1 || userRows[0]["email"] != LocalUserEmail {
		t.Fatalf("unexpected local user seed: %#v", userRows)
	}

	rows := queryRows(t, app.DB, "SELECT user_id, tier, message_credits_used, credits_reset_date, tabular_model FROM user_profiles:local;")
	if len(rows) != 1 {
		t.Fatalf("local profile rows = %d, want 1: %#v", len(rows), rows)
	}
	if rows[0]["tier"] != "Local" || rows[0]["tabular_model"] != "gemma4" {
		t.Fatalf("unexpected local profile: %#v", rows[0])
	}
	if rows[0]["message_credits_used"] != float64(0) || rows[0]["credits_reset_date"] != "9999-12-31T23:59:59Z" {
		t.Fatalf("unexpected non-restricting local profile values: %#v", rows[0])
	}
	if app.User != LocalUser() {
		t.Fatalf("app user = %#v, want local user", app.User)
	}
}

func TestOpenUsesEnvAndLocalStorageOverride(t *testing.T) {
	dataDir := t.TempDir()
	storageRoot := filepath.Join(t.TempDir(), "bytes")
	t.Setenv(DataDirEnv, dataDir)
	t.Setenv(LocalStorageEnv, storageRoot)

	app, err := Open(context.Background(), Options{Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer closeTestApp(t, app)

	if app.DataDir != dataDir {
		t.Fatalf("data dir = %q, want env value %q", app.DataDir, dataDir)
	}
	if app.LocalStorageRoot != storageRoot {
		t.Fatalf("local storage root = %q, want override %q", app.LocalStorageRoot, storageRoot)
	}
	if _, err := os.Stat(storageRoot); err != nil {
		t.Fatalf("storage override was not created: %v", err)
	}
}

func TestSchemaStatementsApplyIndividually(t *testing.T) {
	db, err := persistence.Open(filepath.Join(t.TempDir(), SurrealKVDirName), persistence.Options{Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := db.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
	}()

	for _, statement := range splitSurrealStatements(schemaSurrealQL) {
		if _, err := db.Query(context.Background(), statement); err != nil {
			t.Fatalf("schema statement failed:\n%s\nerror: %v", statement, err)
		}
	}
}

func TestRecordsPersistAcrossRestart(t *testing.T) {
	dataDir := t.TempDir()
	app := openTestAppAt(t, dataDir)
	execStatements(t, app.DB, `
		CREATE companies:restart CONTENT {
			user_id: users:local,
			name: "Restart Co",
			website: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE applications:restart CONTENT {
			user_id: users:local,
			company_id: companies:restart,
			name: "Restarted",
			cm_number: NONE,
			visibility: "private",
			shared_with: [],
			created_at: time::now(),
			updated_at: time::now()
		};
	`)
	closeTestApp(t, app)

	reopened := openTestAppAt(t, dataDir)
	defer closeTestApp(t, reopened)
	rows := queryRows(t, reopened.DB, "SELECT name FROM applications:restart;")
	if len(rows) != 1 || rows[0]["name"] != "Restarted" {
		t.Fatalf("persisted application not found after restart: %#v", rows)
	}
}

func TestSingleWriterGuardCatchesSameProcessReopen(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	_, err := Open(context.Background(), Options{DataDir: app.DataDir})
	if err == nil {
		t.Fatal("expected same-process double-open to fail")
	}
	if !strings.Contains(err.Error(), singleWriterErrMsg) {
		t.Fatalf("double-open error = %v, want helpful single-writer message", err)
	}
}

func TestCloseClearsWorkflowDBPointer(t *testing.T) {
	app := openTestApp(t)
	if activeWorkflowDB(app.DataDir) == nil {
		t.Fatal("workflow db pointer was not registered")
	}
	closeTestApp(t, app)
	if activeWorkflowDB(app.DataDir) != nil {
		t.Fatal("workflow db pointer was not cleared on close")
	}
}

func TestSingleUserLocalHelpers(t *testing.T) {
	user := LocalUser()
	if user.UserID != LocalUserID || user.UserEmail != LocalUserEmail || user.Token != LocalUserToken {
		t.Fatalf("local user = %#v", user)
	}
	if got := UserFromContext(context.Background()); got != user {
		t.Fatalf("default context user = %#v, want %#v", got, user)
	}
	custom := UserContext{UserID: "custom", UserEmail: "custom@example.test", Token: "token"}
	if got := UserFromContext(WithUserContext(context.Background(), custom)); got != custom {
		t.Fatalf("context user = %#v, want %#v", got, custom)
	}
	access := SingleUserAccess()
	if !access.IsOwner || len(access.SharedWith) != 0 {
		t.Fatalf("single-user access = %#v", access)
	}
	if !CreditsAllowed() {
		t.Fatal("local credits should be non-blocking")
	}
}

func TestLocalHelperEdgeCases(t *testing.T) {
	if got := workerID(""); got != "luke-local-worker" {
		t.Fatalf("default worker ID = %q", got)
	}
	if got := workerID("custom-worker"); got != "custom-worker" {
		t.Fatalf("custom worker ID = %q", got)
	}

	wrapped := wrapOpenError(errors.New("failed to acquire lock: already in use"))
	if !strings.Contains(wrapped.Error(), singleWriterErrMsg) {
		t.Fatalf("wrapped open error = %v", wrapped)
	}
	plain := errors.New("plain")
	if returned := wrapOpenError(plain); !errors.Is(returned, plain) {
		t.Fatal("non-lock open error should be returned unchanged")
	}

	if nullableJSON([]byte("null")) != "NONE" {
		t.Fatal("null JSON should become NONE")
	}
	if nullableJSON([]byte(`{"ok":true}`)) != `{"ok":true}` {
		t.Fatal("object JSON should be preserved")
	}
	if _, err := parseTimeField(123); err == nil {
		t.Fatal("expected non-string datetime to fail")
	}
}

func TestWorkflowPayloadHelpers(t *testing.T) {
	input := DocumentOperationInput{}
	defaulted := input.withDefaults(context.Background())
	if defaulted.User != LocalUser() || defaulted.Payload == nil {
		t.Fatalf("defaulted input = %#v", defaulted)
	}

	for name, payload := range map[string]map[string]any{
		"float":       {"value": float64(2)},
		"int":         {"value": 3},
		"int64":       {"value": int64(4)},
		"json-number": {"value": json.Number("5")},
	} {
		if got, ok := payloadNumber(payload, "value"); !ok || got == 0 {
			t.Fatalf("%s payloadNumber = %d, %v", name, got, ok)
		}
	}
	if _, ok := payloadNumber(map[string]any{"value": json.Number("bad")}, "value"); ok {
		t.Fatal("invalid json.Number should not parse")
	}
	if _, err := persistDocumentWorkflowPayload(context.Background(), nil, DocumentOperationInput{WorkflowName: "unknown"}, "workflow_operations:unknown"); err == nil {
		t.Fatal("expected unsupported workflow to fail")
	}
}

func TestLocalUserMiddlewareInjectsLocalUser(t *testing.T) {
	var got UserContext
	handler := LocalUserMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = UserFromContext(r.Context())
		w.WriteHeader(http.StatusAccepted)
	}))

	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusAccepted)
	}
	if got != LocalUser() {
		t.Fatalf("middleware user = %#v, want %#v", got, LocalUser())
	}
}

func TestLocalCORSMiddlewareAllowsBrowserOrigin(t *testing.T) {
	called := false
	handler := LocalCORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", BrowserLocalOrigin)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if !called {
		t.Fatal("wrapped handler was not called")
	}
	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusAccepted)
	}
	if res.Header().Get("Access-Control-Allow-Origin") != BrowserLocalOrigin {
		t.Fatalf("CORS origin header = %q", res.Header().Get("Access-Control-Allow-Origin"))
	}

	optionsReq := httptest.NewRequest(http.MethodOptions, "/", nil)
	optionsReq.Header.Set("Origin", BrowserLocalOrigin)
	optionsRes := httptest.NewRecorder()
	handler.ServeHTTP(optionsRes, optionsReq)
	if optionsRes.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS status = %d, want %d", optionsRes.Code, http.StatusNoContent)
	}
}

func TestLocalStorageAtomicWriteReadAndSweep(t *testing.T) {
	root := t.TempDir()
	if err := WriteLocalFileAtomic(root, "docs/doc.txt", []byte("hello")); err != nil {
		t.Fatal(err)
	}
	data, err := ReadLocalFile(root, "docs/doc.txt")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Fatalf("stored bytes = %q", data)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", tempFilePrefix+"orphan"), []byte("tmp"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SweepTempFiles(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "docs", tempFilePrefix+"orphan")); !os.IsNotExist(err) {
		t.Fatalf("orphan temp file still exists or stat failed: %v", err)
	}
	if err := WriteLocalFileAtomic(root, "../escape", []byte("nope")); err == nil {
		t.Fatal("expected escaping local storage path to fail")
	}
}

func TestLocalStorageRejectsSymlinkComponents(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "linked")); err != nil {
		t.Fatal(err)
	}
	if err := WriteLocalFileAtomic(root, "linked/escape.txt", []byte("nope")); err == nil {
		t.Fatal("expected symlinked local storage path to fail")
	}
	if _, err := os.Stat(filepath.Join(outside, "escape.txt")); !os.IsNotExist(err) {
		t.Fatalf("outside file exists or stat failed: %v", err)
	}
}

func TestLocalStorageRejectsInvalidPaths(t *testing.T) {
	if _, err := safeLocalPath("", "doc.txt"); err == nil {
		t.Fatal("expected empty local storage root to fail")
	}
	if _, err := safeLocalPath(t.TempDir(), ""); err == nil {
		t.Fatal("expected empty local storage path to fail")
	}
	if _, err := safeLocalPath(t.TempDir(), filepath.Join(string(os.PathSeparator), "tmp", "doc.txt")); err == nil {
		t.Fatal("expected absolute local storage path to fail")
	}
}

func TestDownloadTokensResolveLocalPayload(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	created, err := CreateDownloadToken(context.Background(), app.DB, map[string]any{
		"storage_path": "docs/doc.txt",
		"filename":     "doc.txt",
	}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if created.Token == "" {
		t.Fatal("download token was empty")
	}
	resolved, err := ResolveDownloadToken(context.Background(), app.DB, created.Token)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Payload["storage_path"] != "docs/doc.txt" || resolved.Payload["filename"] != "doc.txt" {
		t.Fatalf("resolved payload = %#v", resolved.Payload)
	}
}

func TestSchemaEnforcesEnumsAndObjectFields(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	_, err := app.DB.Query(context.Background(), `
		CREATE documents:bad_status CONTENT {
			application_id: NONE,
			user_id: users:local,
			filename: "bad.txt",
			file_type: "txt",
			size_bytes: 1,
			page_count: NONE,
			structure_tree: NONE,
			status: "bogus",
			folder_id: NONE,
			current_version_id: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
	`)
	if err == nil {
		t.Fatal("expected DB-side enum validation to reject invalid document status")
	}

	_, err = app.DB.Query(context.Background(), `
		CREATE documents:bad_json CONTENT {
			application_id: NONE,
			user_id: users:local,
			filename: "bad.txt",
			file_type: "txt",
			size_bytes: 1,
			page_count: NONE,
			structure_tree: ["not", "an", "object"],
			status: "ready",
			folder_id: NONE,
			current_version_id: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
	`)
	if err == nil {
		t.Fatal("expected DB-side object validation to reject non-object structure_tree")
	}

	_, err = app.DB.Query(context.Background(), `
		CREATE tabular_cells:bad_status CONTENT {
			review_id: tabular_reviews:missing,
			document_id: documents:missing,
			column_index: 0,
			content: NONE,
			citations: NONE,
			status: "complete",
			created_at: time::now()
		};
	`)
	if err == nil {
		t.Fatal("expected DB-side enum validation to reject legacy tabular status complete")
	}
}

func TestSchemaAcceptsCompatibilityPayloadShapes(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	execStatements(t, app.DB, `
		CREATE companies:compat_shapes CONTENT {
			user_id: users:local,
			name: "Compat Co",
			website: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE applications:compat_shapes CONTENT {
			user_id: users:local,
			company_id: companies:compat_shapes,
			name: "Compat",
			cm_number: NONE,
			visibility: "shared",
			shared_with: ["shared@example.test"],
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE workflows:compat_shapes CONTENT {
			user_id: users:local,
			title: "Compat Workflow",
			is_system: false,
			created_at: time::now()
		};
		CREATE documents:compat_shapes CONTENT {
			application_id: applications:compat_shapes,
			user_id: users:local,
			filename: "compat.txt",
			file_type: "txt",
			size_bytes: 12,
			page_count: NONE,
			structure_tree: { root: [] },
			status: "error",
			folder_id: NONE,
			current_version_id: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE chats:compat_shapes CONTENT {
			application_id: applications:compat_shapes,
			user_id: users:local,
			title: "Compat Chat",
			created_at: time::now()
		};
		CREATE chat_messages:compat_user CONTENT {
			chat_id: chats:compat_shapes,
			role: "user",
			content: "hello",
			files: [{ name: "resume.txt", type: "text/plain" }],
			annotations: NONE,
			created_at: time::now()
		};
		CREATE chat_messages:compat_assistant CONTENT {
			chat_id: chats:compat_shapes,
			role: "assistant",
			content: [{ type: "text_delta", text: "hi" }],
			files: NONE,
			annotations: [{ type: "citation", document_id: documents:compat_shapes }],
			created_at: time::now()
		};
		CREATE tabular_reviews:compat_shapes CONTENT {
			application_id: applications:compat_shapes,
			user_id: users:local,
			title: "Compat Review",
			columns_config: [{ index: 0, name: "Summary", prompt: "Summarize" }],
			workflow_id: workflows:compat_shapes,
			practice: NONE,
			shared_with: ["reviewer@example.test"],
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE tabular_cells:compat_shapes CONTENT {
			review_id: tabular_reviews:compat_shapes,
			document_id: documents:compat_shapes,
			column_index: 0,
			content: "{\"summary\":\"ok\"}",
			citations: { refs: [] },
			status: "done",
			created_at: time::now()
		};
		CREATE tabular_review_chats:compat_shapes CONTENT {
			review_id: tabular_reviews:compat_shapes,
			user_id: users:local,
			title: "Review Chat",
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE tabular_review_chat_messages:compat_user CONTENT {
			chat_id: tabular_review_chats:compat_shapes,
			role: "user",
			content: "hello",
			annotations: NONE,
			created_at: time::now()
		};
		CREATE tabular_review_chat_messages:compat_assistant CONTENT {
			chat_id: tabular_review_chats:compat_shapes,
			role: "assistant",
			content: [{ type: "text_delta", text: "hi" }],
			annotations: [{ type: "citation", cell_id: tabular_cells:compat_shapes }],
			created_at: time::now()
		};
	`)
}

func TestDBCascadeDeletesChildren(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(), `
		CREATE companies:cascade CONTENT {
			user_id: users:local,
			name: "Cascade Co",
			website: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE applications:cascade CONTENT {
			user_id: users:local,
			company_id: companies:cascade,
			name: "Cascade",
			cm_number: NONE,
			visibility: "private",
			shared_with: [],
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE application_folders:cascade CONTENT {
			application_id: applications:cascade,
			user_id: users:local,
			name: "Folder",
			parent_folder_id: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
	`+documentStatement("cascade", "applications:cascade", "cascade.txt", "application_folders:cascade", "NONE")+versionStatement("cascade_v1", "documents:cascade", "objects/cascade.txt", "cascade.txt")+`
		DELETE applications:cascade;
	`); err != nil {
		t.Fatal(err)
	}

	assertNoRows(t, app.DB, "SELECT * FROM application_folders WHERE application_id = applications:cascade;")
	assertNoRows(t, app.DB, "SELECT * FROM documents WHERE application_id = applications:cascade;")
	assertNoRows(t, app.DB, "SELECT * FROM document_versions WHERE document_id = documents:cascade;")
}

func TestDBCascadeDeletesDocumentChildren(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(),
		documentStatement("doc_cascade", "NONE", "doc.txt", "NONE", "NONE")+
			versionStatement("doc_cascade_v1", "documents:doc_cascade", "objects/doc.txt", "doc.txt")+
			editStatement("doc_cascade_edit", "documents:doc_cascade", "document_versions:doc_cascade_v1")+
			tabularReviewStatement("doc_cascade_review", "NONE", "NONE")+`
		CREATE tabular_cells:doc_cascade_cell CONTENT {
			review_id: tabular_reviews:doc_cascade_review,
			document_id: documents:doc_cascade,
			column_index: 0,
			content: "cell",
			citations: { refs: [] },
			status: "done",
			created_at: time::now()
		};
		DELETE documents:doc_cascade;
	`); err != nil {
		t.Fatal(err)
	}

	assertNoRows(t, app.DB, "SELECT * FROM document_versions WHERE document_id = documents:doc_cascade;")
	assertNoRows(t, app.DB, "SELECT * FROM document_edits WHERE document_id = documents:doc_cascade;")
	assertNoRows(t, app.DB, "SELECT * FROM tabular_cells WHERE document_id = documents:doc_cascade;")
}

func TestDBCascadeDeletesDocumentVersionChildren(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(),
		documentStatement("version_cascade_doc", "NONE", "version.txt", "NONE", "document_versions:version_cascade_v1")+
			versionStatement("version_cascade_v1", "documents:version_cascade_doc", "objects/version.txt", "version.txt")+
			editStatement("version_cascade_edit", "documents:version_cascade_doc", "document_versions:version_cascade_v1")+`
		DELETE document_versions:version_cascade_v1;
	`); err != nil {
		t.Fatal(err)
	}

	assertNoRows(t, app.DB, "SELECT * FROM document_edits WHERE version_id = document_versions:version_cascade_v1;")
	rows := queryRows(t, app.DB, "SELECT current_version_id FROM documents:version_cascade_doc;")
	if len(rows) != 1 || rows[0]["current_version_id"] != nil {
		t.Fatalf("current_version_id after version delete = %#v, want NONE", rows)
	}
}

func TestDBCascadeDeletesChatChildren(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(), `
		CREATE chats:chat_cascade CONTENT {
			application_id: NONE,
			user_id: users:local,
			title: "Chat",
			created_at: time::now()
		};
		CREATE chat_messages:chat_cascade_message CONTENT {
			chat_id: chats:chat_cascade,
			role: "user",
			content: { text: "hello" },
			files: NONE,
			annotations: NONE,
			created_at: time::now()
		};
		DELETE chats:chat_cascade;
	`); err != nil {
		t.Fatal(err)
	}

	assertNoRows(t, app.DB, "SELECT * FROM chat_messages WHERE chat_id = chats:chat_cascade;")
}

func TestDBCascadeClearsWorkflowChildren(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(), `
		CREATE workflows:workflow_cascade CONTENT {
			user_id: users:local,
			title: "Workflow",
			type: "custom",
			prompt_md: NONE,
			columns_config: [{ index: 0, name: "Summary", prompt: "Summarize" }],
			practice: NONE,
			is_system: false,
			created_at: time::now()
		};
		CREATE workflow_shares:workflow_cascade_share CONTENT {
			workflow_id: workflows:workflow_cascade,
			shared_by_user_id: users:local,
			shared_with_email: "shared@example.test",
			allow_edit: false,
			created_at: time::now()
		};
	`+tabularReviewStatement("workflow_cascade_review", "NONE", "workflows:workflow_cascade")+`
		DELETE workflows:workflow_cascade;
	`); err != nil {
		t.Fatal(err)
	}

	assertNoRows(t, app.DB, "SELECT * FROM workflow_shares WHERE workflow_id = workflows:workflow_cascade;")
	rows := queryRows(t, app.DB, "SELECT workflow_id FROM tabular_reviews:workflow_cascade_review;")
	if len(rows) != 1 || rows[0]["workflow_id"] != nil {
		t.Fatalf("workflow_id after workflow delete = %#v, want NONE", rows)
	}
}

func TestDBCascadeDeletesTabularReviewChildren(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(),
		documentStatement("tabular_cascade_doc", "NONE", "tabular.txt", "NONE", "NONE")+
			tabularReviewStatement("tabular_cascade_review", "NONE", "NONE")+`
		CREATE tabular_cells:tabular_cascade_cell CONTENT {
			review_id: tabular_reviews:tabular_cascade_review,
			document_id: documents:tabular_cascade_doc,
			column_index: 0,
			content: "cell",
			citations: { refs: [] },
			status: "done",
			created_at: time::now()
		};
		CREATE tabular_review_chats:tabular_cascade_chat CONTENT {
			review_id: tabular_reviews:tabular_cascade_review,
			user_id: users:local,
			title: "Review Chat",
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE tabular_review_chat_messages:tabular_cascade_message CONTENT {
			chat_id: tabular_review_chats:tabular_cascade_chat,
			role: "user",
			content: { text: "hello" },
			annotations: NONE,
			created_at: time::now()
		};
		DELETE tabular_reviews:tabular_cascade_review;
	`); err != nil {
		t.Fatal(err)
	}

	assertNoRows(t, app.DB, "SELECT * FROM tabular_cells WHERE review_id = tabular_reviews:tabular_cascade_review;")
	assertNoRows(t, app.DB, "SELECT * FROM tabular_review_chats WHERE review_id = tabular_reviews:tabular_cascade_review;")
	assertNoRows(t, app.DB, "SELECT * FROM tabular_review_chat_messages WHERE chat_id = tabular_review_chats:tabular_cascade_chat;")
}

func TestLoadBearingIndexesAreDefined(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	raw, err := app.DB.Query(context.Background(), `
		INFO FOR TABLE documents;
		INFO FOR TABLE document_versions;
		INFO FOR TABLE chats;
		INFO FOR TABLE chat_messages;
		INFO FOR TABLE tabular_reviews;
		INFO FOR TABLE tabular_cells;
		INFO FOR TABLE tabular_review_chat_messages;
	`)
	if err != nil {
		t.Fatal(err)
	}
	info := string(raw)
	for _, snippet := range []string{
		"documents_application_folder_idx",
		"application_id, folder_id",
		"document_versions_doc_created_idx",
		"document_id, created_at",
		"document_versions_doc_vnum_idx",
		"document_id, version_number",
		"UNIQUE",
		"chats_application_idx",
		"application_id",
		"chat_messages_chat_idx",
		"chat_id, created_at",
		"tabular_reviews_application_idx",
		"tabular_cells_review_doc_column_idx",
		"review_id, document_id, column_index",
		"tabular_review_chat_messages_chat_idx",
	} {
		if !strings.Contains(info, snippet) {
			t.Fatalf("schema info missing index snippet %q: %s", snippet, raw)
		}
	}
}

func TestTransactionsWrapMultiRecordWrites(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if err := app.DB.Transaction(context.Background(), func(ctx context.Context, tx *persistence.Tx) error {
		_, err := tx.Query(ctx, `
			CREATE chats:tx_append CONTENT {
				application_id: NONE,
				user_id: users:local,
				title: "Tx",
				created_at: time::now()
			};
			CREATE chat_messages:tx_user CONTENT {
				chat_id: chats:tx_append,
				role: "user",
				content: { text: "hello" },
				files: NONE,
				annotations: NONE,
				created_at: time::now()
			};
			CREATE chat_messages:tx_assistant CONTENT {
				chat_id: chats:tx_append,
				role: "assistant",
				content: { text: "hi" },
				files: NONE,
				annotations: NONE,
				created_at: time::now()
			};
		`)
		return err
	}); err != nil {
		t.Fatal(err)
	}

	rows := queryRows(t, app.DB, "SELECT * FROM chat_messages WHERE chat_id = chats:tx_append;")
	if len(rows) != 2 {
		t.Fatalf("chat append transaction wrote %d messages, want 2", len(rows))
	}
}

func TestRepositoryWritePathsUseTransactions(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(), `
		CREATE companies:repo_tx CONTENT {
			user_id: users:local,
			name: "Repo Co",
			website: NONE,
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE applications:repo_tx CONTENT {
			user_id: users:local,
			company_id: companies:repo_tx,
			name: "Repo Tx",
			cm_number: NONE,
			visibility: "private",
			shared_with: [],
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE tabular_reviews:repo_tx_review CONTENT {
			application_id: applications:repo_tx,
			user_id: users:local,
			title: "Review",
			columns_config: [{ index: 0, name: "Summary", prompt: "Summarize" }],
			workflow_id: NONE,
			practice: NONE,
			shared_with: [],
			created_at: time::now(),
			updated_at: time::now()
		};
		CREATE chats:repo_tx_chat CONTENT {
			application_id: applications:repo_tx,
			user_id: users:local,
			title: "Chat",
			created_at: time::now()
		};
	`); err != nil {
		t.Fatal(err)
	}
	if err := AppendChatMessages(context.Background(), app.DB, "repo_tx_chat", []ChatMessageWrite{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: []map[string]any{{"type": "text_delta", "text": "hi"}}},
	}); err != nil {
		t.Fatal(err)
	}
	rows := queryRows(t, app.DB, "SELECT * FROM chat_messages WHERE chat_id = chats:repo_tx_chat;")
	if len(rows) != 2 {
		t.Fatalf("append wrote %d messages, want 2", len(rows))
	}
	if err := DeleteTabularReview(context.Background(), app.DB, "repo_tx_review"); err != nil {
		t.Fatal(err)
	}
	assertNoRows(t, app.DB, "SELECT * FROM tabular_reviews WHERE id = tabular_reviews:repo_tx_review;")
	if err := DeleteApplication(context.Background(), app.DB, "repo_tx"); err != nil {
		t.Fatal(err)
	}
	assertNoRows(t, app.DB, "SELECT * FROM applications WHERE id = applications:repo_tx;")
}

func TestMigrateEncodedChatMessageIDsRepairsCanonicalChatReference(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	if _, err := app.DB.Query(context.Background(), `
		CREATE chats:chat_encoded CONTENT {
			user_id: users:local,
			application_id: NONE,
			title: "Encoded",
			created_at: time::now()
		};
		CREATE chat_messages:legacy_encoded CONTENT {
			chat_id: chats:chats_3Achat_encoded,
			role: "assistant",
			content: "orphaned",
			files: [],
			annotations: [],
			created_at: time::now()
		};
	`); err != nil {
		t.Fatal(err)
	}

	if err := migrateEncodedChatMessageIDs(context.Background(), app.DB); err != nil {
		t.Fatal(err)
	}

	assertOneRow(t, app.DB, "SELECT * FROM chat_messages WHERE id = chat_messages:legacy_encoded AND chat_id = chats:chat_encoded;")
}

func TestDocumentWorkflowsUseDeterministicUpsertsAndLocalUser(t *testing.T) {
	app := openTestApp(t)
	defer closeTestApp(t, app)

	type workflowStarter func(context.Context, DocumentOperationInput) (string, error)
	workflows := []struct {
		name  string
		start workflowStarter
	}{
		{
			name: DocumentUploadWorkflowName,
			start: func(ctx context.Context, input DocumentOperationInput) (string, error) {
				return romancy.StartWorkflow(ctx, app.Romancy, app.Workflows.Upload, input)
			},
		},
		{
			name: EditResolutionWorkflowName,
			start: func(ctx context.Context, input DocumentOperationInput) (string, error) {
				return romancy.StartWorkflow(ctx, app.Romancy, app.Workflows.EditResolution, input)
			},
		},
		{
			name: GeneratedDocumentWorkflowName,
			start: func(ctx context.Context, input DocumentOperationInput) (string, error) {
				return romancy.StartWorkflow(ctx, app.Romancy, app.Workflows.Generated, input)
			},
		},
	}

	ctx := WithUserContext(context.Background(), app.User)
	for _, workflow := range workflows {
		t.Run(workflow.name, func(t *testing.T) {
			targetID := workflow.name + "-doc-123"
			firstPayload := map[string]any{
				"document_id":  targetID,
				"version_id":   targetID + "-v1",
				"edit_id":      targetID + "-edit",
				"change_id":    "change-1",
				"filename":     targetID + ".txt",
				"file_type":    "txt",
				"storage_path": "tmp/" + targetID + ".txt",
				"content":      "first",
				"status":       "accepted",
			}
			instanceID, err := workflow.start(ctx, DocumentOperationInput{
				TargetID: targetID,
				Payload:  firstPayload,
			})
			if err != nil {
				t.Fatal(err)
			}
			result := waitForWorkflowResult(t, ctx, app, instanceID)
			wantOperationID := workflowOperationID(workflow.name, targetID)
			if result.OperationID != wantOperationID {
				t.Fatalf("operation id = %q, want %q", result.OperationID, wantOperationID)
			}
			if result.UserID != LocalUserID {
				t.Fatalf("workflow user = %q, want local user", result.UserID)
			}

			replayPayload := map[string]any{
				"document_id":  targetID,
				"version_id":   targetID + "-v1",
				"edit_id":      targetID + "-edit",
				"change_id":    "change-1",
				"filename":     targetID + ".txt",
				"file_type":    "txt",
				"storage_path": "tmp/" + targetID + ".txt",
				"content":      "replay",
				"status":       "accepted",
			}
			instanceID, err = workflow.start(ctx, DocumentOperationInput{
				TargetID: targetID,
				User:     UserContext{UserID: "remote-user", UserEmail: "remote@example.test", Token: "remote-token"},
				Payload:  replayPayload,
			})
			if err != nil {
				t.Fatal(err)
			}
			replayResult := waitForWorkflowResult(t, ctx, app, instanceID)
			if replayResult.UserID != LocalUserID {
				t.Fatalf("replay workflow user = %q, want local user", replayResult.UserID)
			}

			rows := queryRows(t, app.DB, "SELECT workflow_name, target_id, user_id, payload FROM "+wantOperationID+";")
			if len(rows) != 1 {
				t.Fatalf("workflow operation rows = %d, want one deterministic upsert: %#v", len(rows), rows)
			}
			if rows[0]["workflow_name"] != workflow.name || rows[0]["target_id"] != targetID || rows[0]["user_id"] != "users:local" {
				t.Fatalf("unexpected workflow operation row: %#v", rows[0])
			}
			payload, ok := rows[0]["payload"].(map[string]any)
			if !ok {
				t.Fatalf("payload = %#v, want object", rows[0]["payload"])
			}
			if payload["storage_path"] != replayPayload["storage_path"] {
				t.Fatalf("payload after replay = %#v, want %#v", payload, replayPayload)
			}
			if workflow.name == EditResolutionWorkflowName {
				assertOneRow(t, app.DB, "SELECT * FROM document_edits WHERE id = "+recordID("document_edits", targetID+"-edit")+";")
			} else {
				assertOneRow(t, app.DB, "SELECT * FROM documents WHERE id = "+recordID("documents", targetID)+";")
			}
			assertOneRow(t, app.DB, "SELECT * FROM document_versions WHERE id = "+recordID("document_versions", targetID+"-v1")+";")
			data, err := ReadLocalFile(app.LocalStorageRoot, "tmp/"+targetID+".txt")
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != "replay" {
				t.Fatalf("workflow storage bytes = %q, want replay", data)
			}
		})
	}
}

func TestDocumentWorkflowDBBindingIsPerApp(t *testing.T) {
	appA := openTestApp(t)
	defer closeTestApp(t, appA)
	appB := openTestApp(t)
	defer closeTestApp(t, appB)

	ctx := WithUserContext(context.Background(), appA.User)
	instanceID, err := romancy.StartWorkflow(ctx, appA.Romancy, appA.Workflows.Upload, DocumentOperationInput{
		TargetID: "shared-target",
		Payload:  map[string]any{"storage_path": "tmp/app-a"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = waitForWorkflowResult(t, ctx, appA, instanceID)

	operationID := workflowOperationID(DocumentUploadWorkflowName, "shared-target")
	if rows := queryRows(t, appA.DB, "SELECT * FROM "+operationID+";"); len(rows) != 1 {
		t.Fatalf("app A workflow operation rows = %#v, want one row", rows)
	}
	assertNoRows(t, appB.DB, "SELECT * FROM "+operationID+";")
}

func openTestApp(t *testing.T) *App {
	t.Helper()
	return openTestAppAt(t, t.TempDir())
}

func openTestAppAt(t *testing.T, dataDir string) *App {
	t.Helper()
	app, err := Open(context.Background(), Options{DataDir: dataDir, Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	return app
}

func closeTestApp(t *testing.T, app *App) {
	t.Helper()
	if err := app.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func queryRows(t *testing.T, db *persistence.DB, query string) []map[string]any {
	t.Helper()
	result, err := db.Query(context.Background(), query)
	if err != nil {
		t.Fatalf("query failed for %q: %v", query, err)
	}
	return decodeSingleStatementRows(t, result)
}

func decodeSingleStatementRows(t *testing.T, raw json.RawMessage) []map[string]any {
	t.Helper()
	var statements [][]map[string]any
	if err := json.Unmarshal(raw, &statements); err != nil {
		t.Fatalf("decode localdata query result %s: %v", raw, err)
	}
	if len(statements) != 1 {
		t.Fatalf("localdata query returned %d statement groups: %s", len(statements), raw)
	}
	return statements[0]
}

func execStatements(t *testing.T, db *persistence.DB, query string) {
	t.Helper()
	for _, statement := range splitSurrealStatements(query) {
		if _, err := db.Query(context.Background(), statement); err != nil {
			t.Fatalf("surreal statement failed:\n%s\nerror: %v", statement, err)
		}
	}
}

func assertNoRows(t *testing.T, db *persistence.DB, query string) {
	t.Helper()
	if rows := queryRows(t, db, query); len(rows) != 0 {
		t.Fatalf("query %q returned %#v, want no rows", query, rows)
	}
}

func assertOneRow(t *testing.T, db *persistence.DB, query string) {
	t.Helper()
	if rows := queryRows(t, db, query); len(rows) != 1 {
		t.Fatalf("query %q returned %#v, want one row", query, rows)
	}
}

func documentStatement(id, applicationID, filename, folderID, currentVersionID string) string {
	return fmt.Sprintf(`
		CREATE documents:%s CONTENT {
			application_id: %s,
			user_id: users:local,
			filename: %q,
			file_type: "txt",
			size_bytes: 4,
			page_count: NONE,
			structure_tree: { root: [] },
			status: "ready",
			folder_id: %s,
			current_version_id: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, id, applicationID, filename, folderID, currentVersionID)
}

func versionStatement(id, documentID, storagePath, displayName string) string {
	return fmt.Sprintf(`
		CREATE document_versions:%s CONTENT {
			document_id: %s,
			storage_path: %q,
			pdf_storage_path: NONE,
			source: "upload",
			version_number: 1,
			display_name: %q,
			created_at: time::now()
		};
	`, id, documentID, storagePath, displayName)
}

func editStatement(id, documentID, versionID string) string {
	return fmt.Sprintf(`
		CREATE document_edits:%s CONTENT {
			document_id: %s,
			chat_message_id: NONE,
			version_id: %s,
			change_id: "change-1",
			del_w_id: NONE,
			ins_w_id: NONE,
			deleted_text: "",
			inserted_text: "new",
			context_before: NONE,
			context_after: NONE,
			status: "pending",
			created_at: time::now(),
			resolved_at: NONE
		};
	`, id, documentID, versionID)
}

func tabularReviewStatement(id, applicationID, workflowID string) string {
	return fmt.Sprintf(`
		CREATE tabular_reviews:%s CONTENT {
			application_id: %s,
			user_id: users:local,
			title: "Review",
			columns_config: [{ index: 0, name: "Summary", prompt: "Summarize" }],
			workflow_id: %s,
			practice: NONE,
			shared_with: [],
			created_at: time::now(),
			updated_at: time::now()
		};
	`, id, applicationID, workflowID)
}

func splitSurrealStatements(query string) []string {
	var statements []string
	start := 0
	depth := 0
	for i, r := range query {
		switch r {
		case '{', '[', '(':
			depth++
		case '}', ']', ')':
			if depth > 0 {
				depth--
			}
		case ';':
			if depth == 0 {
				statement := strings.TrimSpace(query[start : i+1])
				if statement != "" {
					statements = append(statements, statement)
				}
				start = i + 1
			}
		}
	}
	if statement := strings.TrimSpace(query[start:]); statement != "" {
		statements = append(statements, statement)
	}
	return statements
}

func waitForWorkflowResult(t *testing.T, ctx context.Context, app *App, instanceID string) DocumentOperationResult {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		result, err := romancy.GetWorkflowResult[DocumentOperationResult](ctx, app.Romancy, instanceID)
		if err == nil && result.Status == "completed" {
			return result.Output
		}
		if err != nil && !isWorkflowPending(err) {
			t.Fatal(err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("workflow %s did not complete", instanceID)
	return DocumentOperationResult{}
}

func isWorkflowPending(err error) bool {
	if err == nil {
		return false
	}
	var notFound *romancy.WorkflowNotFoundError
	return errors.Is(err, romancy.ErrWorkflowAlreadyCompleted) ||
		errors.As(err, &notFound) ||
		strings.Contains(err.Error(), "not completed")
}
