package localapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CaliLuke/loom-mcp/runtime/agent/model"
	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
	"github.com/CaliLuke/luke/backend-go/internal/localdata"
)

func TestLocalAPIChatAndTabularStreamsPersistMessages(t *testing.T) {
	// V2 is now the default chat path. This test still covers the legacy V1
	// wire shape (and the tabular-review chat, which has not been migrated
	// yet) — pin it to V1 explicitly. Delete this t.Setenv together with the
	// rest of the V1 chat code when the migration finishes.
	t.Setenv("LUKE_CHAT_V1", "true")
	t.Setenv(mockProviderEnvVar, "1")
	handler, closeApp := newTestHandler(t)
	defer closeApp()

	doc := uploadTestDocument(t, handler)
	docID := trimRecord(asString(doc["id"]))
	review := postJSONForTest(t, handler, "/tabular-review", map[string]any{
		"title":          "Review",
		"document_ids":   []string{docID},
		"columns_config": []map[string]any{{"index": 0, "name": "Summary", "prompt": "Summarize"}},
	}, http.StatusCreated)
	reviewID := trimRecord(asString(review["id"]))

	globalEvents := postSSEForTest(t, handler, "/chat", map[string]any{
		"messages": []map[string]string{{"role": "user", "content": "Summarize this."}},
	})
	assertSSETypes(t, globalEvents, []string{"chat_id", "content_delta", "citations", "done"})
	chatID := eventString(t, globalEvents[0], "chat_id")
	chatDetail := getJSONForTest(t, handler, "/chats/"+chatID, http.StatusOK)
	assertMessageRoles(t, chatDetail["messages"], []string{"user", "assistant"})

	encodedFullChatID := url.PathEscape("chats:" + chatID)
	postSSEForTest(t, handler, "/chat", map[string]any{
		"chat_id":  encodedFullChatID,
		"messages": []map[string]string{{"role": "user", "content": "Follow up."}},
	})
	chatDetail = getJSONForTest(t, handler, "/chats/"+encodedFullChatID, http.StatusOK)
	assertMessageRoles(t, chatDetail["messages"], []string{"user", "assistant", "user", "assistant"})

	tabularEvents := postSSEForTest(t, handler, "/tabular-review/"+reviewID+"/chat", map[string]any{
		"messages": []map[string]string{{"role": "user", "content": "What changed?"}},
	})
	assertSSETypes(t, tabularEvents, []string{"chat_id", "content_delta", "citations", "done"})
	tabularChatID := eventString(t, tabularEvents[0], "chat_id")
	tabularMessages := getJSONArrayForTest(t, handler, "/tabular-review/"+reviewID+"/chats/"+tabularChatID+"/messages", http.StatusOK)
	assertMessageRoles(t, tabularMessages, []string{"user", "assistant"})

	cellEvents := postSSEForTest(t, handler, "/tabular-review/"+reviewID+"/generate", map[string]any{
		"document_ids":    []string{docID},
		"column_indices":  []int{0},
		"columnIndices":   []int{0},
		"requested_model": "ignored-for-compat",
	})
	assertSSETypes(t, cellEvents, []string{"cell_update", "done"})
	cell, ok := cellEvents[0]["cell"].(map[string]any)
	if !ok {
		t.Fatalf("cell_update missing cell payload: %#v", cellEvents[0])
	}
	contentMap, ok := cellEvents[0]["content"].(map[string]any)
	if !ok {
		t.Fatalf("cell_update content is not an object: %#v", cellEvents[0]["content"])
	}
	if got := asString(contentMap["summary"]); got != "Mock completion" {
		t.Fatalf("cell_update content.summary = %q, want provider mock output", got)
	}
	if got := int(cellEvents[0]["column_index"].(float64)); got != 0 {
		t.Fatalf("cell_update column_index = %d, want 0", got)
	}
	cellContent, ok := cell["content"].(map[string]any)
	if !ok {
		t.Fatalf("tabular generate cell.content is not an object: %#v", cell["content"])
	}
	if got := asString(cellContent["summary"]); got != "Mock completion" {
		t.Fatalf("tabular generate content.summary = %q, want provider mock output", got)
	}
}

func TestLocalAPIFrontendCompatibilityAliases(t *testing.T) {
	t.Setenv(mockProviderEnvVar, "1")
	handler, closeApp := newTestHandler(t)
	defer closeApp()

	company := postJSONForTest(t, handler, "/companies", map[string]any{"name": "Smoke Company"}, http.StatusCreated)
	companyID := trimRecord(asString(company["id"]))
	application := postJSONForTest(t, handler, "/applications", map[string]any{"name": "Smoke Application", "company_id": companyID}, http.StatusCreated)
	applicationID := trimRecord(asString(application["id"]))

	uploaded := uploadTestDocumentToPath(t, handler, "/applications/"+applicationID+"/documents")
	documentID := trimRecord(asString(uploaded["id"]))
	documents := getJSONArrayForTest(t, handler, "/applications/"+applicationID+"/documents", http.StatusOK)
	if len(documents) != 1 || trimRecord(asString(documents[0]["id"])) != documentID {
		t.Fatalf("application document upload alias did not persist application document: %#v", documents)
	}

	standalone := uploadTestDocument(t, handler)
	standaloneID := trimRecord(asString(standalone["id"]))
	attached := postJSONForTest(t, handler, "/applications/"+applicationID+"/documents/"+standaloneID, nil, http.StatusOK)
	if trimRecord(asString(attached["application_id"])) != applicationID {
		t.Fatalf("application document attach alias application_id = %q, want %q", asString(attached["application_id"]), applicationID)
	}

	createdChat := postJSONForTest(t, handler, "/chat/create", map[string]any{}, http.StatusCreated)
	chatID := trimRecord(asString(createdChat["id"]))
	chatDetail := getJSONForTest(t, handler, "/chat/"+chatID, http.StatusOK)
	if trimRecord(asString(chatDetail["chat"].(map[string]any)["id"])) != chatID {
		t.Fatalf("chat alias detail = %#v, want chat id %q", chatDetail, chatID)
	}

	applicationChat := postJSONForTest(t, handler, "/chat/create", map[string]any{"application_id": applicationID}, http.StatusCreated)
	applicationChatID := trimRecord(asString(applicationChat["id"]))
	applicationChats := getJSONArrayForTest(t, handler, "/applications/"+applicationID+"/chats", http.StatusOK)
	foundApplicationChat := false
	for _, chat := range applicationChats {
		if trimRecord(asString(chat["id"])) == applicationChatID {
			foundApplicationChat = true
			break
		}
	}
	if !foundApplicationChat {
		t.Fatalf("chat/create application_id alias did not create a application chat: %#v", applicationChats)
	}

	postJSONForTest(t, handler, "/workflows", map[string]any{"title": "Assistant Flow", "type": "assistant"}, http.StatusCreated)
	postJSONForTest(t, handler, "/workflows", map[string]any{"title": "Tabular Flow", "type": "tabular"}, http.StatusCreated)
	assistantWorkflows := getJSONArrayForTest(t, handler, "/workflows?type=assistant", http.StatusOK)
	if len(assistantWorkflows) == 0 {
		t.Fatalf("workflow type filter returned no assistant workflows")
	}
	for _, workflow := range assistantWorkflows {
		if got := asString(workflow["type"]); got != "assistant" {
			t.Fatalf("workflow type filter returned %q workflow: %#v", got, workflow)
		}
	}

	zipBody := postRawForTest(t, handler, "/single-documents/download-zip", map[string]any{"document_ids": []string{documentID}}, http.StatusOK)
	if _, err := zip.NewReader(bytes.NewReader(zipBody), int64(len(zipBody))); err != nil {
		t.Fatalf("download-zip alias returned invalid zip: %v", err)
	}

	deleteForTest(t, handler, "/user/account", http.StatusOK)
}

func TestAssistantCompanyAndApplicationToolsPersistRecords(t *testing.T) {
	app, err := localdata.Open(context.Background(), localdata.Options{
		DataDir:          t.TempDir(),
		LocalStorageRoot: t.TempDir(),
		WorkerID:         "assistant-company-test",
	})
	if err != nil {
		t.Fatalf("open localdata app: %v", err)
	}
	defer func() {
		if closeErr := app.Close(context.Background()); closeErr != nil {
			t.Fatalf("close localdata app: %v", closeErr)
		}
	}()

	payload, err := careercontext.MarshalCreateCompanyPayload(&careercontext.CreateCompanyPayload{
		Name:    new("Acme Recruiting"),
		Website: new("https://acme.example"),
	})
	if err != nil {
		t.Fatalf("marshal create company payload: %v", err)
	}
	var events []map[string]any
	server := &Server{app: app}
	send := func(event map[string]any) error {
		events = append(events, event)
		return nil
	}
	created := executeCreateCompanyToolForTest(t, server, payload, send)
	assertCompanyToolResultForTest(t, app, created, events)

	duplicatePayload, err := careercontext.MarshalCreateCompanyPayload(&careercontext.CreateCompanyPayload{
		Name: new("Acme Recruiting, Inc."),
	})
	if err != nil {
		t.Fatalf("marshal duplicate create company payload: %v", err)
	}
	reused := executeCreateCompanyToolForTest(t, server, duplicatePayload, send)
	if reused.CompanyID == nil || created.CompanyID == nil || *reused.CompanyID != *created.CompanyID {
		t.Fatalf("duplicate company was not reused: created=%#v reused=%#v", created, reused)
	}
	if reused.ReusedExisting == nil || !*reused.ReusedExisting {
		t.Fatalf("duplicate company result missing reused_existing: %#v", reused)
	}

	applicationPayload, err := careercontext.MarshalCreateApplicationPayload(&careercontext.CreateApplicationPayload{
		Name:               new("Senior Product Counsel"),
		CompanyID:          created.CompanyID,
		JobDescriptionText: new("GitHub is hiring a Senior Product Counsel to support product teams."),
		JobDescriptionURL:  new("https://example.com/jobs/123"),
	})
	if err != nil {
		t.Fatalf("marshal create application payload: %v", err)
	}
	applicationResult, err := server.executeCreateApplication(context.Background(), &planner.ToolRequest{
		Name:    careercontext.CreateApplication,
		Payload: applicationPayload,
	}, send)
	if err != nil {
		t.Fatalf("execute create application: %v", err)
	}
	createdApplication, ok := applicationResult.Result.(*careercontext.CreateApplicationResult)
	if !ok {
		t.Fatalf("tool result type = %T, want *careercontext.CreateApplicationResult", applicationResult.Result)
	}
	assertApplicationToolResultForTest(t, app, createdApplication, created, events)
}

func TestPlannerForcesWebPageFetchForURL(t *testing.T) {
	p := newLukeOllamaPlanner("ignored", nil, nil)
	result, err := p.PlanStart(context.Background(), &planner.PlanInput{
		Messages: []*model.Message{{
			Role: model.ConversationRoleUser,
			Parts: []model.Part{model.TextPart{
				Text: "create an application for this job https://www.github.careers/careers-home/jobs/5140?lang=en-us",
			}},
		}},
	})
	if err != nil {
		t.Fatalf("plan start: %v", err)
	}
	if len(result.ToolCalls) != 1 {
		t.Fatalf("tool call count = %d, want 1", len(result.ToolCalls))
	}
	if result.ToolCalls[0].Name != careercontext.FetchWebPage {
		t.Fatalf("tool call name = %q, want %q", result.ToolCalls[0].Name, careercontext.FetchWebPage)
	}
	if !strings.Contains(string(result.ToolCalls[0].Payload), "github.careers") {
		t.Fatalf("tool call payload missing URL: %s", result.ToolCalls[0].Payload)
	}
}

func executeCreateCompanyToolForTest(t *testing.T, server *Server, payload []byte, send func(map[string]any) error) *careercontext.CreateCompanyResult {
	t.Helper()
	result, err := server.executeCreateCompany(context.Background(), &planner.ToolRequest{
		Name:    careercontext.CreateCompany,
		Payload: payload,
	}, send)
	if err != nil {
		t.Fatalf("execute create company: %v", err)
	}
	created, ok := result.Result.(*careercontext.CreateCompanyResult)
	if !ok {
		t.Fatalf("tool result type = %T, want *careercontext.CreateCompanyResult", result.Result)
	}
	return created
}

func assertCompanyToolResultForTest(t *testing.T, app *localdata.App, created *careercontext.CreateCompanyResult, events []map[string]any) {
	t.Helper()
	if created.OK == nil || !*created.OK {
		t.Fatalf("create company result missing success: %#v", created)
	}
	if created.CompanyID == nil || *created.CompanyID == "" {
		t.Fatalf("create company result missing success/id: %#v", created)
	}
	if len(events) == 0 {
		t.Fatalf("company_created event count mismatch: %#v", events)
	}
	if asString(events[0]["type"]) != "company_created" {
		t.Fatalf("company_created event not emitted: %#v", events)
	}
	rows, err := queryRows(context.Background(), app.DB, "SELECT id, name, website FROM "+recordID("companies", *created.CompanyID)+";")
	if err != nil {
		t.Fatalf("query created company: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("created company row count mismatch: %#v", rows)
	}
	if asString(rows[0]["name"]) != "Acme Recruiting" {
		t.Fatalf("created company name mismatch: %#v", rows)
	}
	if asString(rows[0]["website"]) != "https://acme.example" {
		t.Fatalf("created company row mismatch: %#v", rows)
	}
}

func assertApplicationToolResultForTest(t *testing.T, app *localdata.App, createdApplication *careercontext.CreateApplicationResult, created *careercontext.CreateCompanyResult, events []map[string]any) {
	t.Helper()
	if createdApplication.OK == nil || !*createdApplication.OK {
		t.Fatalf("create application result missing success: %#v", createdApplication)
	}
	if createdApplication.ApplicationID == nil || *createdApplication.ApplicationID == "" {
		t.Fatalf("create application result missing success/id: %#v", createdApplication)
	}
	if len(events) == 0 {
		t.Fatalf("application_created event count mismatch: %#v", events)
	}
	if asString(events[len(events)-1]["type"]) != "application_created" {
		t.Fatalf("application_created event not emitted: %#v", events)
	}
	applicationRows, err := queryRows(context.Background(), app.DB, "SELECT id, company_id, name FROM "+recordID("applications", *createdApplication.ApplicationID)+";")
	if err != nil {
		t.Fatalf("query created application: %v", err)
	}
	if len(applicationRows) != 1 {
		t.Fatalf("created application row count mismatch: %#v", applicationRows)
	}
	if asString(applicationRows[0]["name"]) != "Senior Product Counsel" {
		t.Fatalf("created application name mismatch: %#v", applicationRows)
	}
	if trimRecord(asString(applicationRows[0]["company_id"])) != *created.CompanyID {
		t.Fatalf("created application row mismatch: %#v", applicationRows)
	}
	if createdApplication.JobDescriptionDocumentID == nil || *createdApplication.JobDescriptionDocumentID == "" {
		t.Fatalf("create application result missing job description document id: %#v", createdApplication)
	}
	documentRows, err := queryRows(context.Background(), app.DB, "SELECT id, application_id, filename, file_type FROM "+recordID("documents", *createdApplication.JobDescriptionDocumentID)+";")
	if err != nil {
		t.Fatalf("query job description document: %v", err)
	}
	if len(documentRows) != 1 {
		t.Fatalf("job description document row count mismatch: %#v", documentRows)
	}
	if trimRecord(asString(documentRows[0]["application_id"])) != *createdApplication.ApplicationID {
		t.Fatalf("job description document application mismatch: %#v", documentRows)
	}
	if asString(documentRows[0]["file_type"]) != "md" {
		t.Fatalf("job description document file_type mismatch: %#v", documentRows)
	}
	if filepath.Ext(asString(documentRows[0]["filename"])) != ".md" {
		t.Fatalf("job description document filename mismatch: %#v", documentRows)
	}
}

func TestLocalAPIDisplayAndBuiltInWorkflowSeed(t *testing.T) {
	handler, closeApp := newTestHandler(t)
	defer closeApp()

	doc := uploadTestDocument(t, handler)
	docID := trimRecord(asString(doc["id"]))
	display := httptest.NewRecorder()
	handler.ServeHTTP(display, httptest.NewRequest(http.MethodGet, "/single-documents/"+docID+"/display", nil))
	if display.Code != http.StatusOK {
		t.Fatalf("display status = %d, body = %s", display.Code, display.Body.String())
	}
	if got := display.Body.String(); !strings.Contains(got, "fixture document") {
		t.Fatalf("display body did not include uploaded text: %q", got)
	}

	workflows := getJSONArrayForTest(t, handler, "/workflows", http.StatusOK)
	foundBuiltIn := false
	for _, workflow := range workflows {
		if strings.Contains(asString(workflow["id"]), "builtin_credit_summary") {
			foundBuiltIn = true
			break
		}
	}
	if !foundBuiltIn {
		t.Fatalf("seeded workflows did not include builtin_credit_summary: %#v", workflows)
	}
}

func TestRewriteTrackedChangeXMLUsesStructuredTokens(t *testing.T) {
	input := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:del w:author="a&gt;b"><w:r><w:delText>remove</w:delText></w:r></w:del><w:ins><w:r><w:t>keep</w:t></w:r></w:ins></w:r></w:p></w:body></w:document>`
	accepted := rewriteTrackedChangeXML(input, true, "")
	if strings.Contains(accepted, "remove") || !strings.Contains(accepted, "keep") || strings.Contains(accepted, "w:ins") || strings.Contains(accepted, "w:del") {
		t.Fatalf("accepted rewrite did not unwrap insert/drop delete correctly: %s", accepted)
	}
	rejected := rewriteTrackedChangeXML(input, false, "")
	if strings.Contains(rejected, "keep") || !strings.Contains(rejected, "remove") || strings.Contains(rejected, "w:ins") || strings.Contains(rejected, "w:delText") {
		t.Fatalf("rejected rewrite did not unwrap delete/drop insert correctly: %s", rejected)
	}
}

func TestCompatSampleDocxIsReadable(t *testing.T) {
	data, err := os.ReadFile("../../testdata/compat/fixtures/sample.docx")
	if err != nil {
		t.Fatalf("read sample.docx: %v", err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("sample.docx is not a valid zip: %v", err)
	}
	for _, file := range reader.File {
		if file.Name == "word/document.xml" {
			return
		}
	}
	t.Fatalf("sample.docx missing word/document.xml")
}

func newTestHandler(t *testing.T) (http.Handler, func()) {
	t.Helper()
	app, err := localdata.Open(context.Background(), localdata.Options{
		DataDir:          t.TempDir(),
		LocalStorageRoot: t.TempDir(),
		WorkerID:         "localapi-test",
	})
	if err != nil {
		t.Fatalf("open localdata app: %v", err)
	}
	return New(app, nil), func() {
		if err := app.Close(context.Background()); err != nil {
			t.Fatalf("close localdata app: %v", err)
		}
	}
}

func uploadTestDocument(t *testing.T, handler http.Handler) map[string]any {
	t.Helper()
	return decodeObjectForTest(t, uploadTestDocumentBytesToPath(t, handler, "/single-documents"))
}

func uploadTestDocumentToPath(t *testing.T, handler http.Handler, path string) map[string]any {
	t.Helper()
	return decodeObjectForTest(t, uploadTestDocumentBytesToPath(t, handler, path))
}

func uploadTestDocumentBytesToPath(t *testing.T, handler http.Handler, path string) []byte {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "fixture.txt")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write([]byte("fixture document text")); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, path, &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, body = %s", response.Code, response.Body.String())
	}
	return response.Body.Bytes()
}

func postJSONForTest(t *testing.T, handler http.Handler, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != wantStatus {
		t.Fatalf("POST %s status = %d, body = %s", path, response.Code, response.Body.String())
	}
	return decodeObjectForTest(t, response.Body.Bytes())
}

func postRawForTest(t *testing.T, handler http.Handler, path string, body any, wantStatus int) []byte {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != wantStatus {
		t.Fatalf("POST %s status = %d, body = %s", path, response.Code, response.Body.String())
	}
	return response.Body.Bytes()
}

func getJSONForTest(t *testing.T, handler http.Handler, path string, wantStatus int) map[string]any {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != wantStatus {
		t.Fatalf("GET %s status = %d, body = %s", path, response.Code, response.Body.String())
	}
	return decodeObjectForTest(t, response.Body.Bytes())
}

func getJSONArrayForTest(t *testing.T, handler http.Handler, path string, wantStatus int) []map[string]any {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != wantStatus {
		t.Fatalf("GET %s status = %d, body = %s", path, response.Code, response.Body.String())
	}
	var rows []map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, response.Body.String())
	}
	return rows
}

func deleteForTest(t *testing.T, handler http.Handler, path string, wantStatus int) {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodDelete, path, nil))
	if response.Code != wantStatus {
		t.Fatalf("DELETE %s status = %d, body = %s", path, response.Code, response.Body.String())
	}
}

func postSSEForTest(t *testing.T, handler http.Handler, path string, body any) []map[string]any {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal SSE request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("POST %s status = %d, body = %s", path, response.Code, response.Body.String())
	}
	events := []map[string]any{}
	for block := range strings.SplitSeq(response.Body.String(), "\n\n") {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}
		for line := range strings.SplitSeq(block, "\n") {
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			events = append(events, decodeObjectForTest(t, []byte(strings.TrimPrefix(line, "data: "))))
		}
	}
	return events
}

func decodeObjectForTest(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var row map[string]any
	if err := json.Unmarshal(data, &row); err != nil {
		t.Fatalf("decode JSON object: %v; body=%s", err, string(data))
	}
	return row
}

func assertSSETypes(t *testing.T, events []map[string]any, want []string) {
	t.Helper()
	if len(events) != len(want) {
		t.Fatalf("event count = %d, want %d: %#v", len(events), len(want), events)
	}
	for i, event := range events {
		if got := asString(event["type"]); got != want[i] {
			t.Fatalf("event %d type = %q, want %q; events=%#v", i, got, want[i], events)
		}
	}
}

func eventString(t *testing.T, event map[string]any, key string) string {
	t.Helper()
	value := asString(event[key])
	if value == "" {
		t.Fatalf("event missing %s: %#v", key, event)
	}
	return trimRecord(value)
}

func assertMessageRoles(t *testing.T, raw any, want []string) {
	t.Helper()
	messages, ok := raw.([]map[string]any)
	if !ok {
		decoded, decodeOK := raw.([]any)
		if !decodeOK {
			t.Fatalf("messages has type %T, want []map[string]any or []any", raw)
		}
		messages = make([]map[string]any, 0, len(decoded))
		for _, item := range decoded {
			message, itemOK := item.(map[string]any)
			if !itemOK {
				t.Fatalf("message item has type %T", item)
			}
			messages = append(messages, message)
		}
	}
	if len(messages) < len(want) {
		t.Fatalf("message count = %d, want at least %d: %#v", len(messages), len(want), messages)
	}
	for i, role := range want {
		if got := asString(messages[i]["role"]); got != role {
			t.Fatalf("message %d role = %q, want %q; messages=%#v", i, got, role, messages)
		}
	}
}
