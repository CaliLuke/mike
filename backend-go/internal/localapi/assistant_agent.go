package localapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/CaliLuke/loom-mcp/runtime/agent/model"
	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"github.com/CaliLuke/loom-mcp/runtime/agent/rawjson"
	agentruntime "github.com/CaliLuke/loom-mcp/runtime/agent/runtime"
	"github.com/CaliLuke/loom-mcp/runtime/agent/tools"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	assistantagent "github.com/CaliLuke/luke/backend-go/gen/chat/agents/assistant"
	assistantspecs "github.com/CaliLuke/luke/backend-go/gen/chat/agents/assistant/specs"
	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
	"github.com/CaliLuke/luke/backend-go/internal/localdata"
)

const maxToolDocumentChars = 120_000

func (s *Server) persistAndStreamAssistantChat(ctx context.Context, chatID string, modelName *string, applicationID *string, tabularReviewID *string, messages []chatRequestMessage, displayedDoc *chatRequestFile, attachedDocuments []chatRequestFile, send func(map[string]any) error) (string, error) {
	ctx, span := startLocalSpan(ctx, "assistant.persist_and_stream_chat",
		attribute.String("chat.id", chatID),
		attribute.String("assistant.model", modelOrDefault(modelName)),
		attribute.Int("chat.request_message_count", len(messages)),
		attribute.Int("chat.attached_document_count", len(attachedDocuments)),
		attribute.Bool("chat.has_displayed_doc", displayedDoc != nil),
	)
	if applicationID != nil {
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	if tabularReviewID != nil {
		span.SetAttributes(attribute.String("tabular_review.id", *tabularReviewID))
	}
	defer span.End()
	var lastUser string
	var lastUserFiles []chatRequestFile
	var toolAnnotations []map[string]any
	sendWithAnnotations := func(event map[string]any) error {
		if annotation := assistantEventAnnotation(event); annotation != nil {
			toolAnnotations = append(toolAnnotations, annotation)
		}
		return send(event)
	}
	for _, message := range messages {
		if message.Role == "user" {
			lastUser = message.Content
			lastUserFiles = message.Files
		}
	}
	if err := send(map[string]any{"type": "chat_id", "chat_id": chatID}); err != nil {
		recordSpanError(span, err)
		return "", err
	}

	text, err := s.runAssistantAgent(ctx, chatID, modelOrDefault(modelName), applicationID, tabularReviewID, messages, displayedDoc, attachedDocuments, sendWithAnnotations)
	if err != nil {
		recordSpanError(span, err)
		return "", err
	}
	visibleText, citations := splitCitationBlock(text)
	if visibleText == "" {
		visibleText = text
	}
	span.SetAttributes(
		attribute.Int("assistant.raw_response_chars", len(text)),
		attribute.Int("assistant.visible_response_chars", len(visibleText)),
		attribute.Int("assistant.citation_count", len(citations)),
		attribute.Int("assistant.tool_annotation_count", len(toolAnnotations)),
	)
	if err := send(map[string]any{"type": "content_delta", "text": visibleText}); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	if err := send(map[string]any{"type": "citations", "citations": citations}); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	if err := send(map[string]any{"type": "done"}); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}

	persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err := s.insertChatMessageWithFiles(persistCtx, chatID, "user", lastUser, lastUserFiles, nil); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	annotations := append(citations, toolAnnotations...)
	if err := s.insertChatMessage(persistCtx, chatID, "assistant", visibleText, annotations); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	return visibleText, nil
}

func (s *Server) persistAndStreamAssistantTabularChat(ctx context.Context, reviewID, chatID string, modelName *string, messages []chatRequestMessage, send func(map[string]any) error) (string, error) {
	ctx, span := startLocalSpan(ctx, "assistant.persist_and_stream_tabular_chat",
		attribute.String("chat.id", chatID),
		attribute.String("tabular_review.id", reviewID),
		attribute.String("assistant.model", modelOrDefault(modelName)),
		attribute.Int("chat.request_message_count", len(messages)),
	)
	defer span.End()
	if err := send(map[string]any{"type": "chat_id", "chat_id": chatID}); err != nil {
		recordSpanError(span, err)
		return "", err
	}
	text, err := s.runAssistantAgent(ctx, chatID, modelOrDefault(modelName), nil, &reviewID, messages, nil, nil, send)
	if err != nil {
		recordSpanError(span, err)
		return "", err
	}
	visibleText, citations := splitCitationBlock(text)
	if visibleText == "" {
		visibleText = text
	}
	span.SetAttributes(
		attribute.Int("assistant.raw_response_chars", len(text)),
		attribute.Int("assistant.visible_response_chars", len(visibleText)),
		attribute.Int("assistant.citation_count", len(citations)),
	)
	if err := send(map[string]any{"type": "content_delta", "text": visibleText}); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	if err := send(map[string]any{"type": "citations", "citations": citations}); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	if err := send(map[string]any{"type": "done"}); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	var lastUser string
	for _, message := range messages {
		if message.Role == "user" {
			lastUser = message.Content
		}
	}
	persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if err := s.insertTabularChatMessage(persistCtx, chatID, "user", lastUser); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	if err := s.insertTabularChatMessage(persistCtx, chatID, "assistant", visibleText); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	if _, err := s.app.DB.Query(persistCtx, "UPDATE "+recordID("tabular_review_chats", chatID)+" SET review_id = "+recordID("tabular_reviews", reviewID)+", updated_at = time::now();"); err != nil {
		recordSpanError(span, err)
		return visibleText, err
	}
	return visibleText, nil
}

func (s *Server) runAssistantAgent(ctx context.Context, chatID, modelName string, applicationID *string, tabularReviewID *string, messages []chatRequestMessage, displayedDoc *chatRequestFile, attachedDocuments []chatRequestFile, send func(map[string]any) error) (string, error) {
	ctx, span := startLocalSpan(ctx, "assistant.run",
		attribute.String("chat.id", chatID),
		attribute.String("assistant.model", modelName),
		attribute.Int("chat.message_count", len(messages)),
		attribute.Int("chat.attached_document_count", len(attachedDocuments)),
	)
	if applicationID != nil {
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	if tabularReviewID != nil {
		span.SetAttributes(attribute.String("tabular_review.id", *tabularReviewID))
	}
	defer span.End()
	if os.Getenv(mockProviderEnvVar) == "1" {
		return "Mock provider response.\n\n<CITATIONS>[]</CITATIONS>", nil
	}
	rt := agentruntime.New()
	if _, err := rt.SessionStore.CreateSession(ctx, chatID, time.Now()); err != nil {
		return "", err
	}
	planner := newLukeOllamaPlanner(modelName, assistantspecs.AdvertisedSpecs())
	if err := assistantagent.RegisterAssistantAgent(ctx, rt, assistantagent.AssistantAgentConfig{Planner: planner}); err != nil {
		return "", err
	}
	executor := s.newCareerContextExecutor(applicationID, tabularReviewID, displayedDoc, attachedDocuments, messages, send)
	if err := assistantagent.RegisterUsedToolsets(ctx, rt, assistantagent.WithCareerContextExecutor(executor)); err != nil {
		return "", err
	}
	modelMessages := toModelMessages(messages)
	if hint := s.availableDocumentHint(ctx, applicationID, displayedDoc, attachedDocuments, messages); hint != "" {
		modelMessages = append([]*model.Message{{Role: model.ConversationRoleSystem, Parts: []model.Part{model.TextPart{Text: hint}}}}, modelMessages...)
	}
	if tabularReviewID != nil && *tabularReviewID != "" {
		hint := "Current tabular_review_id is " + *tabularReviewID + ". Use read_table_cells with this review_id before answering questions about table cells."
		modelMessages = append([]*model.Message{{Role: model.ConversationRoleSystem, Parts: []model.Part{model.TextPart{Text: hint}}}}, modelMessages...)
	}
	if hint := s.priorAssistantEventHint(ctx, chatID); hint != "" {
		modelMessages = append([]*model.Message{{Role: model.ConversationRoleSystem, Parts: []model.Part{model.TextPart{Text: hint}}}}, modelMessages...)
	}
	output, err := rt.MustClient(assistantagent.AgentID).Run(ctx, chatID, modelMessages)
	if err != nil {
		recordSpanError(span, err)
		return "", err
	}
	return modelMessageText(output.Final), nil
}

func assistantEventAnnotation(event map[string]any) map[string]any {
	eventType, _ := event["type"].(string)
	switch eventType {
	case "doc_created", "doc_edited", "doc_replicated", "workflow_applied", "company_created", "company_match_warning", "application_created", "web_page_fetched":
	default:
		return nil
	}
	annotation := make(map[string]any, len(event))
	for key, value := range event {
		if key == "isStreaming" {
			continue
		}
		annotation[key] = value
	}
	return annotation
}

func toModelMessages(messages []chatRequestMessage) []*model.Message {
	out := make([]*model.Message, 0, len(messages))
	for _, message := range messages {
		role := model.ConversationRole(message.Role)
		if role == "" {
			role = model.ConversationRoleUser
		}
		out = append(out, &model.Message{
			Role:  role,
			Parts: []model.Part{model.TextPart{Text: message.Content}},
		})
	}
	return out
}

func (s *Server) availableDocumentHint(ctx context.Context, applicationID *string, displayedDoc *chatRequestFile, attachedDocuments []chatRequestFile, messages []chatRequestMessage) string {
	extra := make([]chatRequestFile, 0, len(attachedDocuments)+1)
	if displayedDoc != nil {
		extra = append(extra, *displayedDoc)
	}
	extra = append(extra, attachedDocuments...)
	for _, message := range messages {
		extra = append(extra, message.Files...)
	}
	var rows []map[string]any
	where := "true"
	if applicationID != nil && *applicationID != "" {
		where = "application_id = " + recordID("applications", *applicationID)
	}
	if queried, err := queryRows(ctx, s.app.DB, documentListQuery(where)); err == nil {
		rows = queried
	}
	seen := map[string]bool{}
	var lines []string
	for _, row := range rows {
		id := trimRecord(asString(row["id"]))
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		lines = append(lines, "- "+id+": "+asString(row["filename"]))
	}
	for _, file := range extra {
		if file.DocumentID == "" || seen[file.DocumentID] {
			continue
		}
		seen[file.DocumentID] = true
		lines = append(lines, "- "+file.DocumentID+": "+file.Filename)
	}
	if len(lines) == 0 {
		return ""
	}
	return "Available local documents:\n" + strings.Join(lines, "\n") + "\nCall read_document before making claims from a document's contents. Use these document_id values for document tools and citation JSON."
}

func (s *Server) priorAssistantEventHint(ctx context.Context, chatID string) string {
	rows, err := queryRows(ctx, s.app.DB, "SELECT annotations FROM chat_messages WHERE chat_id = "+recordID("chats", chatID)+" AND role = "+surrealString("assistant")+" ORDER BY created_at DESC LIMIT 4;")
	if err != nil {
		return ""
	}
	var lines []string
	for _, row := range rows {
		annotations, ok := row["annotations"].([]any)
		if !ok {
			continue
		}
		for _, raw := range annotations {
			annotation, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			eventType := asString(annotation["type"])
			switch eventType {
			case "doc_created", "doc_edited":
				documentID := asString(annotation["document_id"])
				if documentID == "" {
					continue
				}
				lines = append(lines, "- "+eventType+": "+asString(annotation["filename"])+" document_id="+documentID+" version_id="+asString(annotation["version_id"]))
			case "doc_replicated":
				lines = append(lines, "- doc_replicated: "+asString(annotation["filename"])+" copies="+mustJSON(annotation["copies"]))
			case "workflow_applied":
				lines = append(lines, "- workflow_applied: "+asString(annotation["workflow_id"])+" "+asString(annotation["title"]))
			case "company_created":
				lines = append(lines, "- company_created: "+asString(annotation["company_id"])+" "+asString(annotation["name"]))
			case "company_match_warning":
				lines = append(lines, "- company_match_warning: requested="+asString(annotation["requested_name"])+" similar_company_id="+asString(annotation["similar_company_id"])+" similar_company_name="+asString(annotation["similar_company_name"]))
			case "application_created":
				lines = append(lines, "- application_created: "+asString(annotation["application_id"])+" "+asString(annotation["name"])+" company_id="+asString(annotation["company_id"]))
			case "web_page_fetched":
				lines = append(lines, "- web_page_fetched: "+asString(annotation["title"])+" "+asString(annotation["url"]))
			}
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "Prior assistant tool events in this chat. Use these IDs for follow-up edits or revisions instead of recreating documents:\n" + strings.Join(lines, "\n")
}

type lukeOllamaPlanner struct {
	modelName string
	specs     []tools.ToolSpec
	byOllama  map[string]tools.Ident
}

func newLukeOllamaPlanner(modelName string, specs []tools.ToolSpec) *lukeOllamaPlanner {
	byOllama := make(map[string]tools.Ident, len(specs))
	for _, spec := range specs {
		byOllama[ollamaToolName(spec.Name)] = spec.Name
	}
	return &lukeOllamaPlanner{modelName: modelName, specs: specs, byOllama: byOllama}
}

func (p *lukeOllamaPlanner) PlanStart(ctx context.Context, input *planner.PlanInput) (*planner.PlanResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.plan_start",
		attribute.String("assistant.model", p.modelName),
		attribute.Int("assistant.message_count", len(input.Messages)),
	)
	defer span.End()
	if forced := p.forcedWebPageFetch(input.Messages); forced != nil {
		span.SetAttributes(
			attribute.Bool("assistant.forced_tool", true),
			attribute.String("assistant.tool.name", string(forced.Name)),
		)
		return &planner.PlanResult{ToolCalls: []planner.ToolRequest{*forced}}, nil
	}
	result, err := p.plan(ctx, input.Messages, true)
	recordSpanError(span, err)
	return result, err
}

func (p *lukeOllamaPlanner) PlanResume(ctx context.Context, input *planner.PlanResumeInput) (*planner.PlanResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.plan_resume",
		attribute.String("assistant.model", p.modelName),
		attribute.Int("assistant.message_count", len(input.Messages)),
		attribute.Int("assistant.tool_output_count", len(input.ToolOutputs)),
		attribute.Bool("assistant.finalize", input.Finalize != nil),
	)
	defer span.End()
	result, err := p.plan(ctx, input.Messages, input.Finalize == nil)
	recordSpanError(span, err)
	if result != nil {
		span.SetAttributes(
			attribute.Int("assistant.planned_tool_count", len(result.ToolCalls)),
			attribute.Bool("assistant.final_response", result.FinalResponse != nil),
		)
	}
	return result, err
}

func (p *lukeOllamaPlanner) plan(ctx context.Context, messages []*model.Message, allowTools bool) (*planner.PlanResult, error) {
	if strings.HasPrefix(p.modelName, "claude") || strings.HasPrefix(p.modelName, "gemini") {
		return nil, fmt.Errorf("%s provider is configured but hosted provider calls are disabled locally", p.modelName)
	}
	bodyMessages := []ollamaMessage{{Role: "system", Content: careerSystemPrompt}}
	for _, message := range messages {
		bodyMessages = append(bodyMessages, messageToOllama(message))
	}
	body := map[string]any{
		"model":    p.modelName,
		"messages": bodyMessages,
		"stream":   false,
		"options": map[string]any{
			"temperature": 0.4,
			"top_p":       0.9,
		},
	}
	if allowTools {
		body["tools"] = p.ollamaTools()
	}
	var response ollamaChatResponse
	if err := postOllama(ctx, body, &response); err != nil {
		return nil, err
	}
	if response.Error != "" {
		return nil, fmt.Errorf("ollama error: %s", response.Error)
	}
	calls, err := p.toolRequests(response.Message.ToolCalls)
	if err != nil {
		return nil, err
	}
	if len(calls) > 0 {
		return &planner.PlanResult{ToolCalls: calls}, nil
	}
	return &planner.PlanResult{FinalResponse: &planner.FinalResponse{
		Message: &model.Message{
			Role:  model.ConversationRoleAssistant,
			Parts: []model.Part{model.TextPart{Text: response.Message.Content}},
		},
	}}, nil
}

func (p *lukeOllamaPlanner) forcedWebPageFetch(messages []*model.Message) *planner.ToolRequest {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role != model.ConversationRoleUser {
			continue
		}
		for _, part := range messages[i].Parts {
			textPart, ok := part.(model.TextPart)
			if !ok {
				continue
			}
			rawURL := firstHTTPURL(textPart.Text)
			if rawURL == "" {
				continue
			}
			payload, err := json.Marshal(map[string]any{"url": rawURL, "max_chars": defaultWebPageMaxChars})
			if err != nil {
				return nil
			}
			return &planner.ToolRequest{
				Name:       careercontext.FetchWebPage,
				Payload:    rawjson.Message(payload),
				ToolCallID: newID("toolcall"),
			}
		}
		return nil
	}
	return nil
}

func firstHTTPURL(text string) string {
	for _, field := range strings.Fields(text) {
		candidate := strings.Trim(field, " \t\r\n<>\"'()[]{}.,;!")
		parsed, err := url.Parse(candidate)
		if err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Hostname() != "" {
			return candidate
		}
	}
	return ""
}

func (p *lukeOllamaPlanner) ollamaTools() []map[string]any {
	out := make([]map[string]any, 0, len(p.specs))
	for _, spec := range p.specs {
		var parameters map[string]any
		_ = json.Unmarshal(spec.Payload.Schema, &parameters)
		out = append(out, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        ollamaToolName(spec.Name),
				"description": spec.Description,
				"parameters":  parameters,
			},
		})
	}
	return out
}

func (p *lukeOllamaPlanner) toolRequests(calls []ollamaToolCall) ([]planner.ToolRequest, error) {
	out := make([]planner.ToolRequest, 0, len(calls))
	for _, call := range calls {
		name, ok := p.byOllama[call.Function.Name]
		if !ok {
			continue
		}
		payload, err := normalizeToolArguments(call.Function.Arguments)
		if err != nil {
			return nil, err
		}
		out = append(out, planner.ToolRequest{
			Name:       name,
			Payload:    rawjson.Message(payload),
			ToolCallID: newID("toolcall"),
		})
	}
	return out, nil
}

type ollamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaChatResponse struct {
	Message struct {
		Role      string           `json:"role"`
		Content   string           `json:"content"`
		ToolCalls []ollamaToolCall `json:"tool_calls"`
	} `json:"message"`
	Error string `json:"error"`
}

type ollamaToolCall struct {
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

func messageToOllama(message *model.Message) ollamaMessage {
	if message == nil {
		return ollamaMessage{Role: "user"}
	}
	role := string(message.Role)
	if role == "" {
		role = "user"
	}
	text := modelMessageText(message)
	if toolText := modelToolText(message); toolText != "" {
		text = strings.TrimSpace(text + "\n" + toolText)
	}
	return ollamaMessage{Role: role, Content: text}
}

func modelMessageText(message *model.Message) string {
	if message == nil {
		return ""
	}
	var b strings.Builder
	for _, part := range message.Parts {
		if text, ok := part.(model.TextPart); ok {
			b.WriteString(text.Text)
		}
	}
	return b.String()
}

func modelToolText(message *model.Message) string {
	var lines []string
	for _, part := range message.Parts {
		switch value := part.(type) {
		case model.ToolUsePart:
			lines = append(lines, fmt.Sprintf("Assistant requested tool %s with input: %s", value.Name, mustJSON(value.Input)))
		case model.ToolResultPart:
			lines = append(lines, fmt.Sprintf("Tool result for %s: %s", value.ToolUseID, mustJSON(value.Content)))
		}
	}
	return strings.Join(lines, "\n")
}

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(data)
}

func ollamaToolName(name tools.Ident) string {
	return strings.NewReplacer(".", "__", "-", "_").Replace(string(name))
}

func normalizeToolArguments(data json.RawMessage) ([]byte, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []byte("{}"), nil
	}
	if len(trimmed) > 0 && trimmed[0] == '"' {
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil {
			return nil, err
		}
		trimmed = []byte(s)
	}
	if !json.Valid(trimmed) {
		return nil, fmt.Errorf("invalid tool arguments: %s", string(trimmed))
	}
	return trimmed, nil
}

func splitCitationBlock(text string) (string, []map[string]any) {
	start := strings.LastIndex(text, "<CITATIONS>")
	end := strings.LastIndex(text, "</CITATIONS>")
	if start < 0 || end < 0 || end <= start {
		return strings.TrimSpace(text), []map[string]any{}
	}
	visible := strings.TrimSpace(text[:start])
	raw := strings.TrimSpace(text[start+len("<CITATIONS>") : end])
	var citations []map[string]any
	if err := json.Unmarshal([]byte(raw), &citations); err != nil {
		return visible, []map[string]any{}
	}
	for i := range citations {
		citations[i]["type"] = "citation_data"
		if docID, ok := citations[i]["doc_id"].(string); ok {
			citations[i]["document_id"] = docID
			if citations[i]["filename"] == nil {
				citations[i]["filename"] = docID
			}
		}
	}
	return visible, citations
}

func (s *Server) newCareerContextExecutor(applicationID *string, tabularReviewID *string, displayedDoc *chatRequestFile, attachedDocuments []chatRequestFile, messages []chatRequestMessage, send func(map[string]any) error) agentruntime.ToolCallExecutor {
	extraFiles := make([]chatRequestFile, 0, len(attachedDocuments)+1)
	editStates := map[string]*assistantEditState{}
	if displayedDoc != nil {
		extraFiles = append(extraFiles, *displayedDoc)
	}
	extraFiles = append(extraFiles, attachedDocuments...)
	for _, message := range messages {
		extraFiles = append(extraFiles, message.Files...)
	}
	return agentruntime.ToolCallExecutorFunc(func(ctx context.Context, _ *agentruntime.ToolCallMeta, call *planner.ToolRequest) (*planner.ToolResult, error) {
		switch call.Name {
		case careercontext.ListDocuments:
			return s.executeListDocuments(ctx, call, applicationID, extraFiles)
		case careercontext.ReadDocument:
			return s.executeReadDocument(ctx, call, send)
		case careercontext.FindInDocument:
			return s.executeFindInDocument(ctx, call, send)
		case careercontext.FetchDocuments:
			return s.executeFetchDocuments(ctx, call, send)
		case careercontext.FetchWebPage:
			return s.executeFetchWebPage(ctx, call, send)
		case careercontext.ListWorkflows:
			return s.executeListWorkflows(ctx, call)
		case careercontext.CreateCompany:
			return s.executeCreateCompany(ctx, call, send)
		case careercontext.CreateApplication:
			return s.executeCreateApplication(ctx, call, send)
		case careercontext.ReadWorkflow:
			return s.executeReadWorkflow(ctx, call, send)
		case careercontext.GenerateDocx:
			return s.executeGenerateDocx(ctx, call, applicationID, send)
		case careercontext.EditDocument:
			return s.executeEditDocument(ctx, call, editStates, send)
		case careercontext.ReplicateDocument:
			return s.executeReplicateDocument(ctx, call, applicationID, send)
		case careercontext.ReadTableCells:
			return s.executeReadTableCells(ctx, call, tabularReviewID, send)
		default:
			return &planner.ToolResult{Name: call.Name, Error: planner.NewToolError("unknown career context tool")}, nil
		}
	})
}

type assistantEditState struct {
	Result       assistantDocumentWriteResult
	NextChangeID int
}

func startCareerToolSpan(ctx context.Context, call *planner.ToolRequest, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	base := []attribute.KeyValue{
		attribute.String("assistant.tool.name", string(call.Name)),
		attribute.String("assistant.tool_call_id", call.ToolCallID),
		attribute.Int("assistant.tool_payload_chars", len(call.Payload)),
	}
	base = append(base, attrs...)
	return startLocalSpan(ctx, "assistant.tool."+strings.ReplaceAll(string(call.Name), ".", "_"), base...)
}

func (s *Server) executeListDocuments(ctx context.Context, call *planner.ToolRequest, applicationID *string, extraFiles []chatRequestFile) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call, attribute.Int("assistant.extra_file_count", len(extraFiles)))
	defer span.End()
	where := "true"
	if applicationID != nil && *applicationID != "" {
		where = "application_id = " + recordID("applications", *applicationID)
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	rows, err := queryRows(ctx, s.app.DB, documentListQuery(where))
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	seen := map[string]bool{}
	docs := make([]*careercontext.AssistantDocumentRef, 0, len(rows)+len(extraFiles))
	for _, row := range rows {
		ref := rowToDocumentRef(row)
		documentID := derefString(ref.DocumentID)
		if documentID == "" || seen[documentID] {
			continue
		}
		seen[documentID] = true
		docs = append(docs, ref)
	}
	for _, file := range extraFiles {
		if file.DocumentID == "" || seen[file.DocumentID] {
			continue
		}
		seen[file.DocumentID] = true
		docs = append(docs, &careercontext.AssistantDocumentRef{DocumentID: stringPtr(file.DocumentID), Filename: stringPtr(file.Filename)})
	}
	span.SetAttributes(attribute.Int("assistant.document_count", len(docs)))
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.ListDocumentsResult{Documents: docs}}, nil
}

func (s *Server) executeReadDocument(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalReadDocumentPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	documentID, err := requiredString(payload.DocumentID, "document_id")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("document.id", documentID))
	doc, err := s.readAssistantDocument(ctx, documentID)
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("document.filename", derefString(doc.Filename)), attribute.Int("document.text_chars", len(derefString(doc.Text))))
	_ = send(map[string]any{"type": "doc_read_start", "filename": derefString(doc.Filename), "document_id": documentID})
	_ = send(map[string]any{"type": "doc_read", "filename": derefString(doc.Filename), "document_id": documentID})
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.ReadDocumentResult{DocumentID: doc.DocumentID, Filename: doc.Filename, Text: doc.Text}}, nil
}

func (s *Server) executeFetchDocuments(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalFetchDocumentsPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	docs := make([]*careercontext.AssistantDocumentText, 0, len(payload.DocumentIds))
	span.SetAttributes(attribute.Int("document.request_count", len(payload.DocumentIds)))
	if len(payload.DocumentIds) == 0 {
		err := fmt.Errorf("document_ids is required")
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	for _, docID := range payload.DocumentIds {
		doc, err := s.readAssistantDocument(ctx, docID)
		if err != nil {
			recordSpanError(span, err)
			return toolError(call.Name, err), nil
		}
		_ = send(map[string]any{"type": "doc_read_start", "filename": derefString(doc.Filename), "document_id": docID})
		_ = send(map[string]any{"type": "doc_read", "filename": derefString(doc.Filename), "document_id": docID})
		docs = append(docs, doc)
	}
	span.SetAttributes(attribute.Int("document.result_count", len(docs)))
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.FetchDocumentsResult{Documents: docs}}, nil
}

func (s *Server) executeFindInDocument(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalFindInDocumentPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	documentID, err := requiredString(payload.DocumentID, "document_id")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	query, err := requiredString(payload.Query, "query")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("document.id", documentID), attribute.Int("document.query_chars", len(query)))
	doc, err := s.readAssistantDocument(ctx, documentID)
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	maxResults := 10
	if payload.MaxResults != nil && *payload.MaxResults > 0 && *payload.MaxResults < 50 {
		maxResults = *payload.MaxResults
	}
	contextChars := 120
	if payload.ContextChars != nil && *payload.ContextChars >= 0 && *payload.ContextChars < 1000 {
		contextChars = *payload.ContextChars
	}
	matches, total := findDocumentMatches(derefString(doc.Text), query, maxResults, contextChars)
	span.SetAttributes(attribute.Int("document.match_count", total), attribute.Int("document.returned_match_count", len(matches)))
	_ = send(map[string]any{"type": "doc_find_start", "filename": derefString(doc.Filename), "document_id": documentID, "query": query})
	_ = send(map[string]any{"type": "doc_find", "filename": derefString(doc.Filename), "document_id": documentID, "query": query, "total_matches": total})
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.FindInDocumentResult{
		DocumentID:   doc.DocumentID,
		Filename:     doc.Filename,
		Matches:      matches,
		TotalMatches: intPtr(total),
	}}, nil
}

func (s *Server) executeListWorkflows(ctx context.Context, call *planner.ToolRequest) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, title, type, practice FROM workflows ORDER BY created_at;")
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	workflows := make([]*careercontext.AssistantWorkflowRef, 0, len(rows))
	for _, row := range rows {
		workflows = append(workflows, &careercontext.AssistantWorkflowRef{
			WorkflowID: stringPtr(trimRecord(asString(row["id"]))),
			Title:      stringPtr(asString(row["title"])),
			Type:       stringPtr(asString(row["type"])),
			Practice:   stringPtr(asString(row["practice"])),
		})
	}
	span.SetAttributes(attribute.Int("workflow.count", len(workflows)))
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.ListWorkflowsResult{Workflows: workflows}}, nil
}

func (s *Server) executeCreateCompany(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.tool.create_company",
		attribute.String("assistant.tool_call_id", call.ToolCallID),
	)
	defer span.End()
	payload, err := careercontext.UnmarshalCreateCompanyPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	name, err := requiredString(payload.Name, "name")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("company.requested_name", name))
	var website *string
	if payload.Website != nil {
		trimmed := strings.TrimSpace(*payload.Website)
		if trimmed != "" {
			website = &trimmed
			span.SetAttributes(attribute.String("company.requested_website", trimmed))
		}
	}
	confirmNew := payload.ConfirmNew != nil && *payload.ConfirmNew
	span.SetAttributes(attribute.Bool("company.confirm_new", confirmNew))
	similar, err := s.findSimilarCompanies(ctx, name)
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	span.SetAttributes(attribute.Int("company.similar_count", len(similar)))
	if len(similar) > 0 {
		best := similar[0]
		span.SetAttributes(
			attribute.String("company.similar.id", best.ID),
			attribute.String("company.similar.name", best.Name),
			attribute.Float64("company.similar.score", best.Similarity),
			attribute.Bool("company.similar.exact_key", best.ExactKey),
		)
		if best.ExactKey {
			_ = send(map[string]any{
				"type":            "company_created",
				"company_id":      best.ID,
				"name":            best.Name,
				"reused_existing": true,
			})
			span.SetAttributes(attribute.String("company.dedupe.decision", "reuse_exact"))
			return &planner.ToolResult{Name: call.Name, Result: &careercontext.CreateCompanyResult{
				OK:             boolPtr(true),
				CompanyID:      stringPtr(best.ID),
				Name:           stringPtr(best.Name),
				Website:        stringPtr(best.Website),
				ReusedExisting: boolPtr(true),
				Similarity:     float64Ptr(best.Similarity),
			}}, nil
		}
		if !confirmNew {
			_ = send(map[string]any{
				"type":                 "company_match_warning",
				"requested_name":       name,
				"similar_company_id":   best.ID,
				"similar_company_name": best.Name,
				"similarity":           best.Similarity,
			})
			span.SetAttributes(attribute.String("company.dedupe.decision", "requires_confirmation"))
			return &planner.ToolResult{Name: call.Name, Result: &careercontext.CreateCompanyResult{
				OK:                   boolPtr(false),
				RequiresConfirmation: boolPtr(true),
				SimilarCompanyID:     stringPtr(best.ID),
				SimilarCompanyName:   stringPtr(best.Name),
				Similarity:           float64Ptr(best.Similarity),
				Error:                stringPtr("A similar company already exists. Reuse similar_company_id unless the user confirms this should be a separate company; only then call create_company again with confirm_new=true."),
			}}, nil
		}
		span.SetAttributes(attribute.String("company.dedupe.decision", "create_confirmed"))
	} else {
		span.SetAttributes(attribute.String("company.dedupe.decision", "create_no_match"))
	}
	row, err := s.createCompany(ctx, name, website)
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	companyID := trimRecord(asString(row["id"]))
	companyName := asString(row["name"])
	companyWebsite := asString(row["website"])
	_ = send(map[string]any{"type": "company_created", "company_id": companyID, "name": companyName})
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.CreateCompanyResult{
		OK:             boolPtr(true),
		CompanyID:      stringPtr(companyID),
		Name:           stringPtr(companyName),
		Website:        stringPtr(companyWebsite),
		ReusedExisting: boolPtr(false),
	}}, nil
}

func (s *Server) executeCreateApplication(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.tool.create_application",
		attribute.String("assistant.tool_call_id", call.ToolCallID),
	)
	defer span.End()
	payload, err := careercontext.UnmarshalCreateApplicationPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	name, err := requiredString(payload.Name, "name")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	companyID, err := requiredString(payload.CompanyID, "company_id")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(
		attribute.String("application.name", name),
		attribute.String("company.id", companyID),
		attribute.Bool("application.has_job_description", payload.JobDescriptionText != nil && strings.TrimSpace(*payload.JobDescriptionText) != ""),
	)
	var cmNumber *string
	if payload.CmNumber != nil {
		trimmed := strings.TrimSpace(*payload.CmNumber)
		if trimmed != "" {
			cmNumber = &trimmed
		}
	}
	row, err := s.createApplication(ctx, name, companyID, cmNumber, nil)
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	applicationID := trimRecord(asString(row["id"]))
	applicationName := asString(row["name"])
	attachedCompanyID := trimRecord(asString(row["company_id"]))
	applicationCMNumber := asString(row["cm_number"])
	jobDescriptionDocID := ""
	if payload.JobDescriptionText != nil && strings.TrimSpace(*payload.JobDescriptionText) != "" {
		doc, err := s.createJobDescriptionDocument(ctx, applicationName, strings.TrimSpace(*payload.JobDescriptionText), derefString(payload.JobDescriptionURL), applicationID)
		if err != nil {
			recordSpanError(span, err)
			return nil, err
		}
		jobDescriptionDocID = doc.DocumentID
	}
	span.SetAttributes(
		attribute.String("application.id", applicationID),
		attribute.String("application.job_description_document_id", jobDescriptionDocID),
	)
	_ = send(map[string]any{
		"type":                        "application_created",
		"application_id":              applicationID,
		"company_id":                  attachedCompanyID,
		"name":                        applicationName,
		"job_description_document_id": jobDescriptionDocID,
	})
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.CreateApplicationResult{
		OK:                       boolPtr(true),
		ApplicationID:            stringPtr(applicationID),
		CompanyID:                stringPtr(attachedCompanyID),
		Name:                     stringPtr(applicationName),
		CmNumber:                 stringPtr(applicationCMNumber),
		JobDescriptionDocumentID: stringPtr(jobDescriptionDocID),
	}}, nil
}

func (s *Server) createJobDescriptionDocument(ctx context.Context, applicationName string, text string, sourceURL string, applicationID string) (assistantDocumentWriteResult, error) {
	filename := safeMarkdownFilename("Job Description - " + applicationName)
	body := "# Job Description\n\n" + text
	if sourceURL != "" {
		body = "Source: " + sourceURL + "\n\n" + body
	}
	return s.createAssistantDocument(ctx, filename, "md", []byte(body), "job_description", &applicationID)
}

func (s *Server) executeReadWorkflow(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalReadWorkflowPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	workflowID, err := requiredString(payload.WorkflowID, "workflow_id")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("workflow.id", workflowID))
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, title, type, prompt_md, columns_config, practice FROM "+recordID("workflows", workflowID)+";")
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	if len(rows) == 0 {
		err := fmt.Errorf("workflow not found")
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	row := rows[0]
	span.SetAttributes(attribute.String("workflow.title", asString(row["title"])), attribute.String("workflow.type", asString(row["type"])))
	_ = send(map[string]any{"type": "workflow_applied", "workflow_id": workflowID, "title": asString(row["title"])})
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.ReadWorkflowResult{
		WorkflowID:    stringPtr(trimRecord(asString(row["id"]))),
		Title:         stringPtr(asString(row["title"])),
		Type:          stringPtr(asString(row["type"])),
		PromptMd:      stringPtr(asString(row["prompt_md"])),
		ColumnsConfig: asAnySlice(row["columns_config"]),
		Practice:      stringPtr(asString(row["practice"])),
	}}, nil
}

func (s *Server) executeGenerateDocx(ctx context.Context, call *planner.ToolRequest, applicationID *string, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalGenerateDocxPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	title := derefString(payload.Title)
	if title == "" {
		title = "Document"
	}
	filename := safeDocxFilename(title)
	span.SetAttributes(attribute.String("document.filename", filename), attribute.Int("document.section_count", len(payload.Sections)))
	if applicationID != nil {
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	_ = send(map[string]any{"type": "doc_created_start", "filename": filename})
	data, err := buildSimpleDocx(title, generatedSections(payload.Sections))
	if err != nil {
		recordSpanError(span, err)
		return generateDocxToolError(call.Name, filename, err, send), nil
	}
	span.SetAttributes(attribute.Int("document.bytes", len(data)))
	doc, err := s.createAssistantDocument(ctx, filename, "docx", data, "generated", applicationID)
	if err != nil {
		recordSpanError(span, err)
		return generateDocxToolError(call.Name, filename, err, send), nil
	}
	span.SetAttributes(attribute.String("document.id", doc.DocumentID), attribute.String("document.version_id", doc.VersionID))
	result := &careercontext.GenerateDocxResult{
		OK:            boolPtr(true),
		Filename:      stringPtr(doc.Filename),
		DownloadURL:   stringPtr(doc.DownloadURL),
		DocumentID:    stringPtr(doc.DocumentID),
		VersionID:     stringPtr(doc.VersionID),
		VersionNumber: intPtr(doc.VersionNumber),
	}
	_ = send(map[string]any{
		"type":           "doc_created",
		"filename":       doc.Filename,
		"download_url":   doc.DownloadURL,
		"document_id":    doc.DocumentID,
		"version_id":     doc.VersionID,
		"version_number": doc.VersionNumber,
	})
	return &planner.ToolResult{Name: call.Name, Result: result}, nil
}

func generateDocxToolError(name tools.Ident, filename string, err error, send func(map[string]any) error) *planner.ToolResult {
	result := &careercontext.GenerateDocxResult{OK: boolPtr(false), Error: stringPtr(err.Error()), Filename: stringPtr(filename)}
	_ = send(map[string]any{"type": "doc_created", "filename": filename, "download_url": "", "error": err.Error()})
	return &planner.ToolResult{Name: name, Result: result}
}

func (s *Server) executeReplicateDocument(ctx context.Context, call *planner.ToolRequest, applicationID *string, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalReplicateDocumentPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	documentID, err := requiredString(payload.DocumentID, "document_id")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("document.id", documentID))
	if applicationID != nil {
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	source, err := s.resolveDocumentVersion(ctx, documentID, "")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	data, err := localdata.ReadLocalFile(s.app.LocalStorageRoot, source.StoragePath)
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	count := 1
	if payload.Count != nil && *payload.Count > 0 {
		count = *payload.Count
	}
	if count > 20 {
		count = 20
	}
	span.SetAttributes(attribute.String("document.filename", source.Filename), attribute.Int("document.bytes", len(data)), attribute.Int("document.copy_count", count))
	_ = send(map[string]any{"type": "doc_replicate_start", "filename": source.Filename, "count": count})
	copies := make([]*careercontext.AssistantDocumentCopy, 0, count)
	for i := 1; i <= count; i++ {
		filename := replicatedFilename(source.Filename, derefString(payload.NewFilename), i, count)
		doc, err := s.createAssistantDocument(ctx, filename, strings.TrimPrefix(filepath.Ext(filename), "."), data, "upload", applicationID)
		if err != nil {
			recordSpanError(span, err)
			result := &careercontext.ReplicateDocumentResult{OK: boolPtr(false), Filename: stringPtr(source.Filename), Count: intPtr(len(copies)), Copies: copies, Error: stringPtr(err.Error())}
			_ = send(map[string]any{"type": "doc_replicated", "filename": source.Filename, "count": len(copies), "copies": copies, "error": err.Error()})
			return &planner.ToolResult{Name: call.Name, Result: result}, nil
		}
		copies = append(copies, &careercontext.AssistantDocumentCopy{
			NewFilename: stringPtr(doc.Filename),
			DocumentID:  stringPtr(doc.DocumentID),
			VersionID:   stringPtr(doc.VersionID),
			DownloadURL: stringPtr(doc.DownloadURL),
		})
	}
	span.SetAttributes(attribute.Int("document.created_copy_count", len(copies)))
	result := &careercontext.ReplicateDocumentResult{OK: boolPtr(true), Filename: stringPtr(source.Filename), Count: intPtr(len(copies)), Copies: copies}
	_ = send(map[string]any{"type": "doc_replicated", "filename": source.Filename, "count": len(copies), "copies": copies})
	return &planner.ToolResult{Name: call.Name, Result: result}, nil
}

func (s *Server) executeEditDocument(ctx context.Context, call *planner.ToolRequest, editStates map[string]*assistantEditState, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalEditDocumentPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	documentID, err := requiredString(payload.DocumentID, "document_id")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("document.id", documentID), attribute.Int("document.requested_edit_count", len(payload.Edits)))
	if len(payload.Edits) == 0 {
		err := fmt.Errorf("edits is required")
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	version, err := s.resolveDocumentVersion(ctx, documentID, "")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	if strings.ToLower(filepath.Ext(version.Filename)) != ".docx" {
		err := fmt.Errorf("edit_document only supports .docx files")
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("document.filename", version.Filename))
	_ = send(map[string]any{"type": "doc_edited_start", "filename": version.Filename})
	sourcePath := version.StoragePath
	startChangeID := 1
	if state := editStates[documentID]; state != nil {
		sourcePath = state.Result.StoragePath
		startChangeID = state.NextChangeID
	}
	data, err := localdata.ReadLocalFile(s.app.LocalStorageRoot, sourcePath)
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	requests := make([]trackedEditRequest, 0, len(payload.Edits))
	for _, edit := range payload.Edits {
		find := derefString(edit.Find)
		if find == "" {
			continue
		}
		requests = append(requests, trackedEditRequest{
			Find:    find,
			Replace: derefString(edit.Replace),
			Reason:  derefString(edit.Reason),
		})
	}
	editedBytes, tracked, err := applyTrackedEditsToDocx(data, requests, startChangeID)
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.Int("document.normalized_edit_count", len(requests)), attribute.Int("document.matched_edit_count", len(tracked)))
	if len(tracked) == 0 {
		matchErr := fmt.Errorf("no edits matched the document text")
		recordSpanError(span, matchErr)
		result := &careercontext.EditDocumentResult{OK: boolPtr(false), Filename: stringPtr(version.Filename), DocumentID: stringPtr(documentID), Error: stringPtr(matchErr.Error())}
		_ = send(map[string]any{"type": "doc_edited", "filename": version.Filename, "document_id": documentID, "annotations": []any{}, "error": matchErr.Error()})
		return &planner.ToolResult{Name: call.Name, Result: result}, nil
	}
	annotations := make([]*careercontext.AssistantEditAnnotation, 0, len(tracked))
	for _, item := range tracked {
		annotations = append(annotations, &careercontext.AssistantEditAnnotation{
			Kind:          stringPtr("edit"),
			EditID:        stringPtr(newID("edit")),
			DocumentID:    stringPtr(documentID),
			ChangeID:      stringPtr(item.ChangeID),
			DeletedText:   stringPtrAlways(item.DeletedText),
			InsertedText:  stringPtrAlways(item.InsertedText),
			ContextBefore: stringPtr(item.ContextBefore),
			ContextAfter:  stringPtr(item.ContextAfter),
			Reason:        stringPtr(item.Reason),
			Status:        stringPtr("pending"),
		})
	}
	state := editStates[documentID]
	var newVersion assistantDocumentWriteResult
	if state != nil {
		newVersion, err = s.appendEditedTrackedVersion(ctx, state.Result, editedBytes, annotations)
		if err != nil {
			recordSpanError(span, err)
			return toolError(call.Name, err), nil
		}
		state.Result = newVersion
		state.NextChangeID += len(tracked)
	} else {
		newVersion, err = s.writeEditedTrackedVersion(ctx, documentID, version.Filename, editedBytes, annotations)
		if err != nil {
			recordSpanError(span, err)
			return toolError(call.Name, err), nil
		}
		editStates[documentID] = &assistantEditState{Result: newVersion, NextChangeID: startChangeID + len(tracked)}
	}
	span.SetAttributes(attribute.String("document.version_id", newVersion.VersionID), attribute.Int("document.version_number", newVersion.VersionNumber))
	for _, annotation := range annotations {
		annotation.VersionID = stringPtr(newVersion.VersionID)
		annotation.VersionNumber = intPtr(newVersion.VersionNumber)
	}
	result := &careercontext.EditDocumentResult{
		OK:            boolPtr(true),
		Filename:      stringPtr(version.Filename),
		DownloadURL:   stringPtr(newVersion.DownloadURL),
		DocumentID:    stringPtr(documentID),
		VersionID:     stringPtr(newVersion.VersionID),
		VersionNumber: intPtr(newVersion.VersionNumber),
		Annotations:   annotations,
	}
	_ = send(map[string]any{"type": "doc_edited", "filename": version.Filename, "document_id": documentID, "version_id": newVersion.VersionID, "version_number": newVersion.VersionNumber, "download_url": newVersion.DownloadURL, "annotations": annotations})
	return &planner.ToolResult{Name: call.Name, Result: result}, nil
}

func (s *Server) executeReadTableCells(ctx context.Context, call *planner.ToolRequest, tabularReviewID *string, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()
	payload, err := careercontext.UnmarshalReadTableCellsPayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	reviewID := derefString(payload.ReviewID)
	if reviewID == "" && tabularReviewID != nil {
		reviewID = *tabularReviewID
	}
	if strings.TrimSpace(reviewID) == "" {
		err := fmt.Errorf("review_id is required")
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("tabular_review.id", reviewID), attribute.Int("tabular.col_index_count", len(payload.ColIndices)), attribute.Int("tabular.row_index_count", len(payload.RowIndices)))
	text, label, detailLabel, err := s.readTableCellsText(ctx, reviewID, payload.ColIndices, payload.RowIndices)
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.Int("tabular.text_chars", len(text)), attribute.String("tabular.label", label))
	stableID := "tabular_review:" + reviewID
	_ = send(map[string]any{"type": "doc_read_start", "filename": label, "document_id": stableID, "detail": detailLabel})
	_ = send(map[string]any{"type": "doc_read", "filename": label, "document_id": stableID, "detail": detailLabel})
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.ReadTableCellsResult{Label: stringPtr(detailLabel), Text: stringPtr(text)}}, nil
}

func (s *Server) readAssistantDocument(ctx context.Context, documentID string) (*careercontext.AssistantDocumentText, error) {
	ctx, span := startLocalSpan(ctx, "assistant.document.read",
		attribute.String("document.id", documentID),
	)
	defer span.End()
	if documentID == "" {
		err := fmt.Errorf("document_id is required")
		recordSpanError(span, err)
		return nil, err
	}
	version, err := s.resolveDocumentVersion(ctx, documentID, "")
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	span.SetAttributes(attribute.String("document.filename", version.Filename), attribute.String("document.storage_path", version.StoragePath))
	data, err := localdata.ReadLocalFile(s.app.LocalStorageRoot, version.StoragePath)
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	body, _ := displayBytes(version.Filename, data)
	text := string(body)
	truncated := false
	if len(text) > maxToolDocumentChars {
		text = text[:maxToolDocumentChars] + "\n\n[truncated]"
		truncated = true
	}
	span.SetAttributes(attribute.Int("document.bytes", len(data)), attribute.Int("document.text_chars", len(text)), attribute.Bool("document.truncated", truncated))
	return &careercontext.AssistantDocumentText{DocumentID: stringPtr(documentID), Filename: stringPtr(version.Filename), Text: stringPtr(text)}, nil
}

func rowToDocumentRef(row map[string]any) *careercontext.AssistantDocumentRef {
	return &careercontext.AssistantDocumentRef{
		DocumentID:    stringPtr(trimRecord(asString(row["id"]))),
		Filename:      stringPtr(asString(row["filename"])),
		ApplicationID: stringPtr(trimRecord(asString(row["application_id"]))),
		FileType:      stringPtr(asString(row["file_type"])),
		Status:        stringPtr(asString(row["status"])),
	}
}

type assistantDocumentWriteResult struct {
	DocumentID    string
	VersionID     string
	VersionNumber int
	Filename      string
	DownloadURL   string
	StoragePath   string
}

func findDocumentMatches(text, query string, maxResults, contextChars int) ([]*careercontext.AssistantDocumentMatch, int) {
	if query == "" {
		return nil, 0
	}
	lowerText := strings.ToLower(text)
	lowerQuery := strings.ToLower(query)
	matches := make([]*careercontext.AssistantDocumentMatch, 0, maxResults)
	total := 0
	offset := 0
	for {
		idx := strings.Index(lowerText[offset:], lowerQuery)
		if idx < 0 {
			break
		}
		start := offset + idx
		end := start + len(query)
		total++
		if len(matches) < maxResults {
			contextStart := start - contextChars
			if contextStart < 0 {
				contextStart = 0
			}
			contextEnd := end + contextChars
			if contextEnd > len(text) {
				contextEnd = len(text)
			}
			matches = append(matches, &careercontext.AssistantDocumentMatch{
				Index:   intPtr(len(matches)),
				Start:   intPtr(start),
				End:     intPtr(end),
				Quote:   stringPtr(text[start:end]),
				Context: stringPtr(text[contextStart:contextEnd]),
			})
		}
		offset = end
	}
	return matches, total
}

func toolError(name tools.Ident, err error) *planner.ToolResult {
	return &planner.ToolResult{Name: name, Error: planner.NewToolError(err.Error())}
}

func generatedSections(sections []*careercontext.AssistantDocxSection) []generatedDocxSection {
	out := make([]generatedDocxSection, 0, len(sections))
	for _, section := range sections {
		if section == nil {
			continue
		}
		item := generatedDocxSection{
			Heading:   derefString(section.Heading),
			Level:     1,
			Content:   derefString(section.Content),
			PageBreak: section.PageBreak != nil && *section.PageBreak,
		}
		if section.Level != nil {
			item.Level = *section.Level
		}
		if section.Table != nil {
			item.TableHeaders = section.Table.Headers
			item.TableRows = section.Table.Rows
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		out = append(out, generatedDocxSection{Content: ""})
	}
	return out
}

func (s *Server) createAssistantDocument(ctx context.Context, filename, fileType string, data []byte, source string, applicationID *string) (assistantDocumentWriteResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.document.create",
		attribute.String("document.filename", filename),
		attribute.String("document.file_type", fileType),
		attribute.String("document.source", source),
		attribute.Int("document.bytes", len(data)),
	)
	if applicationID != nil {
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	defer span.End()
	docID := newID("doc")
	versionID := docID + "_v1"
	span.SetAttributes(attribute.String("document.id", docID), attribute.String("document.version_id", versionID))
	if fileType == "" {
		fileType = strings.TrimPrefix(filepath.Ext(filename), ".")
		span.SetAttributes(attribute.String("document.file_type", fileType))
	}
	storagePath := filepath.ToSlash(filepath.Join(docID, filename))
	workflow := s.app.Workflows.Upload
	if source == "generated" {
		workflow = s.app.Workflows.Generated
	}
	payload := map[string]any{
		"document_id":    docID,
		"version_id":     versionID,
		"filename":       filename,
		"file_type":      fileType,
		"storage_path":   storagePath,
		"size_bytes":     len(data),
		"version_number": 1,
		"content_base64": encodeBase64(data),
	}
	if err := s.runDocumentWorkflow(localdata.WithUserContext(ctx, s.app.User), workflow, docID, payload); err != nil {
		recordSpanError(span, err)
		return assistantDocumentWriteResult{}, err
	}
	if applicationID != nil && *applicationID != "" {
		if _, err := s.app.DB.Query(ctx, "UPDATE "+recordID("documents", docID)+" SET application_id = "+recordID("applications", *applicationID)+", updated_at = time::now();"); err != nil {
			recordSpanError(span, err)
			return assistantDocumentWriteResult{}, err
		}
	}
	downloadURL, err := s.createDocumentDownloadURL(ctx, storagePath, filename)
	if err != nil {
		recordSpanError(span, err)
		return assistantDocumentWriteResult{}, err
	}
	return assistantDocumentWriteResult{DocumentID: docID, VersionID: versionID, VersionNumber: 1, Filename: filename, DownloadURL: downloadURL, StoragePath: storagePath}, nil
}

func (s *Server) writeEditedTrackedVersion(ctx context.Context, documentID, filename string, data []byte, annotations []*careercontext.AssistantEditAnnotation) (assistantDocumentWriteResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.document.write_tracked_version",
		attribute.String("document.id", documentID),
		attribute.String("document.filename", filename),
		attribute.Int("document.bytes", len(data)),
		attribute.Int("document.annotation_count", len(annotations)),
	)
	defer span.End()
	versionNumber, err := s.nextVersionNumber(ctx, documentID)
	if err != nil {
		recordSpanError(span, err)
		return assistantDocumentWriteResult{}, err
	}
	versionID := documentID + "_edit_" + strconv.Itoa(versionNumber)
	span.SetAttributes(attribute.String("document.version_id", versionID), attribute.Int("document.version_number", versionNumber))
	storagePath := filepath.ToSlash(filepath.Join(documentID, versionID, filename))
	if writeErr := localdata.WriteLocalFileAtomic(s.app.LocalStorageRoot, storagePath, data); writeErr != nil {
		recordSpanError(span, writeErr)
		return assistantDocumentWriteResult{}, writeErr
	}
	query := fmt.Sprintf(`
		CREATE %s CONTENT {
			document_id: %s,
			storage_path: %s,
			pdf_storage_path: NONE,
			source: "assistant_edit",
			version_number: %d,
			display_name: %s,
			created_at: time::now()
		};
		UPDATE %s SET current_version_id = %s, updated_at = time::now();
	`, recordID("document_versions", versionID), recordID("documents", documentID), surrealString(storagePath), versionNumber, surrealString(filename), recordID("documents", documentID), recordID("document_versions", versionID))
	for _, annotation := range annotations {
		editID := derefString(annotation.EditID)
		if editID == "" {
			editID = newID("edit")
		}
		query += fmt.Sprintf(`
			CREATE %s CONTENT {
				document_id: %s,
				chat_message_id: NONE,
				version_id: %s,
				change_id: %s,
				del_w_id: NONE,
				ins_w_id: NONE,
				deleted_text: %s,
				inserted_text: %s,
				context_before: %s,
				context_after: %s,
				status: "pending",
				created_at: time::now(),
				resolved_at: NONE
			};
		`, recordID("document_edits", editID), recordID("documents", documentID), recordID("document_versions", versionID), surrealString(derefString(annotation.ChangeID)), surrealString(derefString(annotation.DeletedText)), surrealString(derefString(annotation.InsertedText)), surrealString(derefString(annotation.ContextBefore)), surrealString(derefString(annotation.ContextAfter)))
		annotation.EditID = stringPtr(editID)
	}
	if _, queryErr := s.app.DB.Query(ctx, query); queryErr != nil {
		recordSpanError(span, queryErr)
		return assistantDocumentWriteResult{}, queryErr
	}
	downloadURL, err := s.createDocumentDownloadURL(ctx, storagePath, filename)
	if err != nil {
		recordSpanError(span, err)
		return assistantDocumentWriteResult{}, err
	}
	return assistantDocumentWriteResult{DocumentID: documentID, VersionID: versionID, VersionNumber: versionNumber, Filename: filename, DownloadURL: downloadURL, StoragePath: storagePath}, nil
}

func (s *Server) appendEditedTrackedVersion(ctx context.Context, version assistantDocumentWriteResult, data []byte, annotations []*careercontext.AssistantEditAnnotation) (assistantDocumentWriteResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.document.append_tracked_version",
		attribute.String("document.id", version.DocumentID),
		attribute.String("document.version_id", version.VersionID),
		attribute.String("document.filename", version.Filename),
		attribute.Int("document.bytes", len(data)),
		attribute.Int("document.annotation_count", len(annotations)),
	)
	defer span.End()
	if writeErr := localdata.WriteLocalFileAtomic(s.app.LocalStorageRoot, version.StoragePath, data); writeErr != nil {
		recordSpanError(span, writeErr)
		return assistantDocumentWriteResult{}, writeErr
	}
	query := ""
	for _, annotation := range annotations {
		editID := derefString(annotation.EditID)
		if editID == "" {
			editID = newID("edit")
		}
		query += fmt.Sprintf(`
			CREATE %s CONTENT {
				document_id: %s,
				chat_message_id: NONE,
				version_id: %s,
				change_id: %s,
				del_w_id: NONE,
				ins_w_id: NONE,
				deleted_text: %s,
				inserted_text: %s,
				context_before: %s,
				context_after: %s,
				status: "pending",
				created_at: time::now(),
				resolved_at: NONE
			};
		`, recordID("document_edits", editID), recordID("documents", version.DocumentID), recordID("document_versions", version.VersionID), surrealString(derefString(annotation.ChangeID)), surrealString(derefString(annotation.DeletedText)), surrealString(derefString(annotation.InsertedText)), surrealString(derefString(annotation.ContextBefore)), surrealString(derefString(annotation.ContextAfter)))
		annotation.EditID = stringPtr(editID)
	}
	if query != "" {
		if _, queryErr := s.app.DB.Query(ctx, query); queryErr != nil {
			recordSpanError(span, queryErr)
			return assistantDocumentWriteResult{}, queryErr
		}
	}
	return version, nil
}

func (s *Server) createDocumentDownloadURL(ctx context.Context, storagePath, filename string) (string, error) {
	token, err := localdata.CreateDownloadToken(ctx, s.app.DB, map[string]any{
		"storage_path": storagePath,
		"filename":     filename,
	}, time.Hour)
	if err != nil {
		return "", err
	}
	return "/download/" + token.Token, nil
}

func (s *Server) readTableCellsText(ctx context.Context, reviewID string, colIndices, rowIndices []int) (string, string, string, error) {
	detail, err := s.tabularDetail(ctx, reviewID)
	if err != nil {
		return "", "", "", err
	}
	review, _ := detail["review"].(map[string]any)
	columns := columnsFromConfig(review["columns_config"])
	docs, _ := detail["documents"].([]map[string]any)
	cells, _ := detail["cells"].([]map[string]any)
	selectedCols := selectColumns(columns, colIndices)
	selectedDocs := selectRows(docs, rowIndices)
	title := asString(review["title"])
	if title == "" {
		title = "Tabular Review"
	}
	detailLabel := fmt.Sprintf("%s (%d %s x %d %s)", title, len(selectedCols), plural("column", len(selectedCols)), len(selectedDocs), plural("row", len(selectedDocs)))
	cellByKey := make(map[string]map[string]any, len(cells))
	for _, cell := range cells {
		key := fmt.Sprintf("%d:%s", asInt(cell["column_index"]), trimRecord(asString(cell["document_id"])))
		cellByKey[key] = cell
	}
	var lines []string
	for _, col := range selectedCols {
		for rowIndex, doc := range selectedDocs {
			docID := trimRecord(asString(doc["id"]))
			filename := asString(doc["filename"])
			lines = append(lines, fmt.Sprintf("[COL:%d %q | ROW:%d %q]", col.Index, col.Name, rowIndex, filename))
			if cell := cellByKey[fmt.Sprintf("%d:%s", col.Index, docID)]; cell != nil {
				content := asString(cell["content"])
				if strings.TrimSpace(content) == "" {
					content = "(empty)"
				}
				lines = append(lines, content)
			} else {
				lines = append(lines, "(not yet generated)")
			}
			lines = append(lines, "")
		}
	}
	return strings.Join(lines, "\n"), title, detailLabel, nil
}

type assistantColumn struct {
	Index int
	Name  string
}

func columnsFromConfig(value any) []assistantColumn {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	cols := make([]assistantColumn, 0, len(items))
	for i, item := range items {
		m, _ := item.(map[string]any)
		index := asInt(m["index"])
		if index == 0 {
			index = i
		}
		name := asString(m["name"])
		if name == "" {
			name = "Column " + strconv.Itoa(index)
		}
		cols = append(cols, assistantColumn{Index: index, Name: name})
	}
	return cols
}

func selectColumns(columns []assistantColumn, indices []int) []assistantColumn {
	if len(indices) == 0 {
		return columns
	}
	want := make(map[int]bool, len(indices))
	for _, idx := range indices {
		want[idx] = true
	}
	var out []assistantColumn
	for pos, col := range columns {
		if want[pos] || want[col.Index] {
			out = append(out, col)
		}
	}
	return out
}

func selectRows(rows []map[string]any, indices []int) []map[string]any {
	if len(indices) == 0 {
		return rows
	}
	want := make(map[int]bool, len(indices))
	for _, idx := range indices {
		want[idx] = true
	}
	var out []map[string]any
	for i, row := range rows {
		if want[i] {
			out = append(out, row)
		}
	}
	return out
}

func plural(word string, count int) string {
	if count == 1 {
		return word
	}
	return word + "s"
}

func safeDocxFilename(title string) string {
	return safeFilename(title, ".docx")
}

func safeMarkdownFilename(title string) string {
	return safeFilename(title, ".md")
}

func safeFilename(title string, ext string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == ' ' || r == '-' || r == '_' {
			return r
		}
		return -1
	}, title)
	cleaned = strings.TrimSpace(cleaned)
	if len(cleaned) > 64 {
		cleaned = cleaned[:64]
	}
	if cleaned == "" {
		cleaned = "document"
	}
	return cleaned + ext
}

func replicatedFilename(source, requested string, index, count int) string {
	if requested != "" && count == 1 {
		if filepath.Ext(requested) == "" {
			return requested + filepath.Ext(source)
		}
		return requested
	}
	ext := filepath.Ext(source)
	stem := strings.TrimSuffix(source, ext)
	if requested != "" {
		stem = strings.TrimSuffix(requested, filepath.Ext(requested))
	}
	if count == 1 {
		return stem + " (copy)" + ext
	}
	return fmt.Sprintf("%s (%d)%s", stem, index, ext)
}

func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringPtrAlways(value string) *string {
	return &value
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func requiredString(value *string, name string) (string, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return strings.TrimSpace(*value), nil
}

func intPtr(value int) *int {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func float64Ptr(value float64) *float64 {
	return &value
}

func asAnySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}
