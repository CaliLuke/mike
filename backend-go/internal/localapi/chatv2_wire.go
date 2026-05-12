package localapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel/attribute"

	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"github.com/CaliLuke/loom-mcp/runtime/agent/rawjson"
	"github.com/CaliLuke/loom-mcp/runtime/agent/tools"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
	"github.com/CaliLuke/luke/backend-go/internal/localapi/chatv2"
)

// buildOllamaToolSchemas returns the Ollama-shape tool function definitions
// for the chat v2 path. The same translation as the v1 lukeOllamaPlanner
// uses (assistant_agent.go:722) — copied here to keep chatv2 decoupled from
// the loomagent planner runtime.
func buildOllamaToolSchemas() []map[string]any {
	specs := careercontext.Specs
	out := make([]map[string]any, 0, len(specs))
	for _, spec := range specs {
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

// canonicalToolNames maps Ollama-flat names back to the tools.Ident form
// (e.g. "career_context__create_company" -> "career_context.create_company").
func canonicalToolNames() map[string]tools.Ident {
	specs := careercontext.Specs
	out := make(map[string]tools.Ident, len(specs))
	for _, spec := range specs {
		out[ollamaToolName(spec.Name)] = spec.Name
	}
	return out
}

// dispatchToolCall is the entry point activities call to run one tool. It
// fans out to the existing Server.executeXxx methods, captures the
// progress events emitted via the v1-style send callback, and JSON-encodes
// the planner.ToolResult for the next LLM turn.
func (s *Server) dispatchToolCall(
	ctx context.Context,
	in chatv2.ToolDispatchInput,
	onProgress func(payload map[string]any),
) (chatv2.ToolDispatchResult, error) {
	names := canonicalToolNames()
	canonical, ok := names[in.OllamaName]
	if !ok {
		return chatv2.ToolDispatchResult{}, fmt.Errorf("unknown ollama tool name %q", in.OllamaName)
	}
	args, err := normalizeToolArguments(in.Arguments)
	if err != nil {
		return chatv2.ToolDispatchResult{}, fmt.Errorf("normalize tool args: %w", err)
	}
	req := &planner.ToolRequest{
		Name:       canonical,
		Payload:    rawjson.Message(args),
		ToolCallID: in.ToolCallID,
	}
	// v1 tool implementations emit events via this callback (e.g.
	// doc_read_start, web_page_fetched). Funnel them into tool_progress.
	send := func(event map[string]any) error {
		if onProgress != nil && event != nil {
			onProgress(event)
		}
		return nil
	}

	var result *planner.ToolResult
	switch canonical {
	case careercontext.ListDocuments:
		result, err = s.executeListDocuments(ctx, req, in.ApplicationID, nil)
	case careercontext.ReadDocument:
		result, err = s.executeReadDocument(ctx, req, send)
	case careercontext.FindInDocument:
		result, err = s.executeFindInDocument(ctx, req, send)
	case careercontext.FetchDocuments:
		result, err = s.executeFetchDocuments(ctx, req, send)
	case careercontext.FetchWebPage:
		result, err = s.executeFetchWebPage(ctx, req, send)
	case careercontext.ListWorkflows:
		result, err = s.executeListWorkflows(ctx, req)
	case careercontext.CreateCompany:
		result, err = s.executeCreateCompany(ctx, req, send)
	case careercontext.CreateApplication:
		result, err = s.executeCreateApplication(ctx, req, send)
	case careercontext.ReadWorkflow:
		result, err = s.executeReadWorkflow(ctx, req, send)
	case careercontext.GenerateDocx:
		result, err = s.executeGenerateDocx(ctx, req, in.ApplicationID, send)
	case careercontext.EditDocument:
		result, err = s.executeEditDocument(ctx, req, map[string]*assistantEditState{}, send)
	case careercontext.ReplicateDocument:
		result, err = s.executeReplicateDocument(ctx, req, in.ApplicationID, send)
	case careercontext.ReadTableCells:
		// tabular_review scope not threaded yet; fine for chat path (only
		// invoked from the tabular reviewer endpoint).
		result, err = s.executeReadTableCells(ctx, req, nil, send)
	case careercontext.SearchCompanies:
		result, err = s.executeSearchCompanies(ctx, req, send)
	case careercontext.SearchDocuments:
		result, err = s.executeSearchDocuments(ctx, req, send)
	case careercontext.SaveDocument:
		result, err = s.executeSaveDocument(ctx, req, send)
	case careercontext.AttachDocumentToApplication:
		result, err = s.executeAttachDocumentToApplication(ctx, req, send)
	case careercontext.DeleteDocument:
		result, err = s.executeDeleteDocument(ctx, req, send)
	default:
		return chatv2.ToolDispatchResult{}, fmt.Errorf("unhandled canonical tool name %q", canonical)
	}
	if err != nil {
		return chatv2.ToolDispatchResult{}, err
	}
	resultJSON, err := encodeToolResultJSON(result)
	if err != nil {
		return chatv2.ToolDispatchResult{}, err
	}
	summary := toolResultSummary(result)
	out := chatv2.ToolDispatchResult{
		CanonicalName: string(canonical),
		ResultJSON:    resultJSON,
		Summary:       summary,
	}
	if result != nil && result.Error != nil {
		out.Error = result.Error.Message
	}
	return out, nil
}

func encodeToolResultJSON(result *planner.ToolResult) (json.RawMessage, error) {
	if result == nil {
		return json.RawMessage("null"), nil
	}
	if result.Result != nil {
		return json.Marshal(result.Result)
	}
	if result.Error != nil {
		return json.Marshal(map[string]any{"error": result.Error.Message})
	}
	return json.RawMessage("{}"), nil
}

// toolResultSummary picks small, useful fields out of a tool result so
// tool_completed events stay light on the wire. Falls back to the empty
// map for unknown shapes.
func toolResultSummary(result *planner.ToolResult) map[string]any {
	if result == nil {
		return nil
	}
	summary := map[string]any{}
	switch v := result.Result.(type) {
	case *careercontext.CreateCompanyResult:
		if v != nil {
			if v.CompanyID != nil {
				summary["company_id"] = *v.CompanyID
			}
			if v.Name != nil {
				summary["name"] = *v.Name
			}
			if v.ReusedExisting != nil {
				summary["reused_existing"] = *v.ReusedExisting
			}
		}
	case *careercontext.CreateApplicationResult:
		if v != nil {
			if v.ApplicationID != nil {
				summary["application_id"] = *v.ApplicationID
			}
			if v.Name != nil {
				summary["name"] = *v.Name
			}
		}
	case *careercontext.FetchWebPageResult:
		if v != nil {
			if v.Title != nil {
				summary["title"] = *v.Title
			}
			if v.URL != nil {
				summary["url"] = *v.URL
			}
		}
	}
	if result.Error != nil {
		summary["error"] = result.Error.Message
	}
	if len(summary) == 0 {
		return nil
	}
	return summary
}

// chatV2Deps builds the chatv2.Deps that bridge the chatv2 package to
// localapi-internal helpers (LLM call, Surreal persistence). Kept in its
// own file so chatv2 stays independently testable.
func (s *Server) chatV2Deps() chatv2.Deps {
	return chatv2.Deps{
		LLMCompletion: func(
			ctx context.Context,
			in chatv2.LLMTurnInput,
			onContentDelta func(string),
			onThinkingDelta func(string),
		) (chatv2.LLMTurnResult, error) {
			messages := make([]map[string]any, 0, len(in.Messages)+2)
			messages = append(messages, map[string]any{
				"role":    "system",
				"content": careerSystemPrompt,
			})
			// When the chat lives inside an application, inject a small
			// context block as a second system message: the application
			// record id and the filenames + ids of its documents. The
			// model uses the doc list to call `doc_read` on demand
			// instead of asking the user "what job?" / "which document?".
			if in.ApplicationID != nil && *in.ApplicationID != "" {
				if block, err := s.buildApplicationContextPrompt(ctx, *in.ApplicationID); err == nil && block != "" {
					messages = append(messages, map[string]any{
						"role":    "system",
						"content": block,
					})
				} else if err != nil {
					slog.WarnContext(ctx, "chatv2.application_context.build_failed",
						"application_id", *in.ApplicationID, "error", err.Error())
				}
			}
			messages = append(messages, in.Messages...)
			body := map[string]any{
				"model":    in.Model,
				"messages": messages,
			}
			if len(in.Tools) > 0 {
				body["tools"] = in.Tools
			}
			var resp ollamaChatResponse
			if err := streamOllamaChat(ctx, body, onThinkingDelta, onContentDelta, &resp); err != nil {
				return chatv2.LLMTurnResult{}, err
			}
			toolCalls := make([]chatv2.LLMToolCall, 0, len(resp.Message.ToolCalls))
			for _, tc := range resp.Message.ToolCalls {
				args, _ := normalizeToolArguments(tc.Function.Arguments)
				toolCalls = append(toolCalls, chatv2.LLMToolCall{
					OllamaName: tc.Function.Name,
					Arguments:  json.RawMessage(args),
				})
			}
			return chatv2.LLMTurnResult{
				Content:   resp.Message.Content,
				Thinking:  resp.Message.Thinking,
				ToolCalls: toolCalls,
			}, nil
		},
		PersistAssistantMessage: func(ctx context.Context, in chatv2.PersistMessageInput) error {
			// chat_messages.content is stored as JSON array; passing the
			// timeline ([]map[string]any) directly matches what
			// createChatMessageWithID writes today on the V1 path.
			return s.createChatMessageWithID(ctx, in.MessageID, in.ChatID, "assistant", in.Content, nil, nil)
		},
		DispatchTool: func(
			ctx context.Context,
			in chatv2.ToolDispatchInput,
			onProgress func(payload map[string]any),
		) (chatv2.ToolDispatchResult, error) {
			return s.dispatchToolCall(ctx, in, onProgress)
		},
		OllamaToolSchemas: buildOllamaToolSchemas(),
		LoadHistory: func(ctx context.Context, chatID string) ([]map[string]any, error) {
			return s.loadChatHistoryAsOllamaMessages(ctx, chatID)
		},
	}
}

// loadChatHistoryAsOllamaMessages reads every persisted chat_messages row
// for chatID in chronological order and flattens them into Ollama-shape
// {role, content, ...} entries the LLM can consume.
//
// Persisted assistant messages store a V2 timeline ([]event) on their
// .content column; we project the "content" events into the assistant
// message body and replay any "tool" events as separate role:"tool"
// entries so the model sees its own prior tool calls and results.
// "reasoning" events are intentionally dropped: they're internal model
// scratchpad output, not part of the next turn's context.
func (s *Server) loadChatHistoryAsOllamaMessages(ctx context.Context, chatID string) ([]map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, surrealSelect{
		Fields:  []string{"role", "content"},
		From:    "chat_messages",
		Where:   "chat_id = " + recordID("chats", chatID),
		OrderBy: []string{"created_at"},
	}.String())
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows)*2)
	for _, row := range rows {
		role := asString(row["role"])
		switch role {
		case "user":
			out = append(out, map[string]any{
				"role":    "user",
				"content": flattenUserContent(row["content"]),
			})
		case "assistant":
			text, toolEntries := flattenAssistantTimeline(row["content"])
			out = append(out, map[string]any{
				"role":    "assistant",
				"content": text,
			})
			out = append(out, toolEntries...)
		default:
			// Skip unknown roles ("system" injected per-turn, etc.)
		}
	}
	return out, nil
}

// flattenUserContent normalizes whatever shape user content was stored in
// back to a plain string for the LLM.
func flattenUserContent(content any) string {
	switch v := content.(type) {
	case string:
		return v
	case []any:
		// Some legacy code may have stored user content as a timeline too.
		var b strings.Builder
		for _, item := range v {
			if m, ok := item.(map[string]any); ok {
				if t := asString(m["text"]); t != "" {
					b.WriteString(t)
				}
			}
		}
		return b.String()
	default:
		return ""
	}
}

// flattenAssistantTimeline turns a stored V2 timeline into:
//   - text: concatenation of every "content" event (the model's final reply)
//   - tools: one role:"tool" message per "tool" event, in order, so the LLM
//     sees the prior tool calls and their results when continuing the chat
func flattenAssistantTimeline(content any) (string, []map[string]any) {
	items, ok := content.([]any)
	if !ok {
		// Defensive: maybe stored as a JSON string we still need to decode.
		if s, isStr := content.(string); isStr {
			var decoded []any
			if err := json.Unmarshal([]byte(s), &decoded); err == nil {
				items = decoded
			}
		}
	}
	var contentBuf strings.Builder
	tools := make([]map[string]any, 0)
	for _, item := range items {
		event, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch asString(event["type"]) {
		case "content":
			if t := asString(event["text"]); t != "" {
				contentBuf.WriteString(t)
			}
		case "tool":
			toolName := asString(event["name"])
			resultJSON, _ := json.Marshal(event["result"])
			entry := map[string]any{
				"role":      "tool",
				"tool_name": toolName,
				"content":   string(resultJSON),
			}
			if errStr := asString(event["error"]); errStr != "" {
				entry["content"] = `{"error":` + strconv.Quote(errStr) + `}`
			}
			tools = append(tools, entry)
		}
	}
	return contentBuf.String(), tools
}

// Suppress unused tools package warning when no callers reference it
// directly elsewhere in this file (the lookup uses it indirectly via
// careercontext.Specs typing).
var _ = tools.Ident("")
var _ = planner.ToolRequest{}
var _ = rawjson.Message(nil)

// chatV2HandlerDeps builds the request-handler-side dependencies the chatv2
// HTTP handler needs.
func (s *Server) chatV2HandlerDeps() chatv2.Dependencies {
	return chatv2.Dependencies{
		Registry: s.chatV2Registry,
		Service:  s.chatV2Service,
		Romancy:  s.app.Romancy,
		CreateChat: func(ctx context.Context, applicationID *string) (string, error) {
			row, err := s.createChat(ctx, applicationID)
			if err != nil {
				return "", err
			}
			return trimRecord(asString(row["id"])), nil
		},
		PersistUserMessage: func(ctx context.Context, chatID, content string) (string, error) {
			id := newID("chatmsg")
			if err := s.createChatMessageWithID(ctx, id, chatID, "user", content, nil, nil); err != nil {
				return "", err
			}
			return id, nil
		},
		DefaultModel: func(model *string) string { return modelOrDefault(model) },
		NewID:        newID,
	}
}

// buildApplicationContextPrompt returns the second system message
// injected when a chat lives inside an application. It tells the model
//   - which application is active (canonical record id + display name)
//   - which company that application is for
//   - the job_description_url, when set on the application
//   - every document attached to the application (id, filename, kind)
//
// The model uses the document list to decide whether to call `doc_read`
// for the job description, resume, etc. rather than asking the user.
//
// Always best-effort: on any DB error returns "" so the system prompt
// stays the single static one. The caller logs the error.
func (s *Server) buildApplicationContextPrompt(ctx context.Context, applicationID string) (string, error) {
	ctx, span := startLocalSpan(ctx, "chatv2.application_context.build",
		attribute.String("application.id", applicationID),
	)
	defer span.End()

	appRows, err := queryRows(ctx, s.app.DB,
		"SELECT id, name, company_id.name AS company_name, job_description_url FROM applications WHERE id = "+
			recordID("applications", applicationID)+" LIMIT 1;")
	if err != nil {
		recordSpanError(span, err)
		return "", err
	}
	if len(appRows) == 0 {
		span.SetAttributes(attribute.String("application_context.skip_reason", "application_not_found"))
		return "", nil
	}
	app := appRows[0]
	canonicalID := asString(app["id"])
	appName := asString(app["name"])
	companyName := asString(app["company_name"])
	jdURL := asString(app["job_description_url"])

	docRows, err := queryRows(ctx, s.app.DB,
		"SELECT id, filename, kind FROM documents WHERE application_id = "+
			recordID("applications", applicationID)+" ORDER BY filename;")
	if err != nil {
		recordSpanError(span, err)
		return "", err
	}

	var b strings.Builder
	b.WriteString("ACTIVE APPLICATION CONTEXT — this chat is scoped to one of the user's job applications. Use the data below.\n")
	b.WriteString("Rules:\n")
	b.WriteString("- Treat the application below as the implicit subject of every request. Never ask the user which job/application/company they mean.\n")
	b.WriteString("- Do NOT call `create_application` — the application already exists and is identified by application_id below. Operate on it.\n")
	b.WriteString("- Before calling `create_company`, ALWAYS call `search_companies` first with the candidate name; only create when no match is acceptable.\n")
	b.WriteString("- To save a fetched job description, scraped text, or any document content, call `save_document` with this application_id (kind=\"job_description\" for JDs). Do NOT use `create_application` for this — that would create a sibling application.\n")
	b.WriteString("- To pull an existing library document (e.g. the user's resume) into this application, call `attach_document_to_application`.\n")
	b.WriteString("- To answer questions about the role, the company, the user's resume, or any other attached material, call `read_document` on the relevant document_id from the list below before responding. Use `search_documents` when the user references something not in the list.\n")
	b.WriteString("\nApplication:\n")
	b.WriteString(fmt.Sprintf("- application_id: %s\n", canonicalID))
	if appName != "" {
		b.WriteString(fmt.Sprintf("- application_name: %s\n", appName))
	}
	if companyName != "" {
		b.WriteString(fmt.Sprintf("- company: %s\n", companyName))
	}
	if jdURL != "" {
		b.WriteString(fmt.Sprintf("- job_description_url: %s\n", jdURL))
	}
	if len(docRows) == 0 {
		b.WriteString("- documents: (none attached yet)\n")
	} else {
		b.WriteString("- documents (call `doc_read` with document_id to fetch contents when relevant):\n")
		for _, row := range docRows {
			docID := asString(row["id"])
			filename := asString(row["filename"])
			kind := asString(row["kind"])
			if kind == "" {
				kind = "unknown"
			}
			b.WriteString(fmt.Sprintf("  • %s (id=%s, kind=%s)\n", filename, docID, kind))
		}
	}

	span.SetAttributes(
		attribute.String("application.name", appName),
		attribute.String("application.company_name", companyName),
		attribute.Bool("application.has_job_description_url", jdURL != ""),
		attribute.Int("application.document_count", len(docRows)),
		attribute.Int("application_context.prompt_chars", b.Len()),
	)
	return b.String(), nil
}
