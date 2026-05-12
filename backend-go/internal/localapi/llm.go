package localapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
)

const (
	defaultMainModel   = "gemma4"
	defaultTitleModel  = "gemma4"
	defaultOllamaURL   = "http://localhost:11434"
	mockProviderEnvVar = "LUKE_MOCK_LLM"
)

const careerSystemPrompt = `You are Luke, a local-first AI workbench for resumes, job searches, and career operations.

You help the user evaluate jobs, tailor resumes and cover letters, prepare for interviews, draft recruiter and hiring-manager messages, and reason about their application pipeline. Be practical, direct, and specific.

Source-of-truth rules:
- Treat uploaded resumes, CVs, job descriptions, notes, interview transcripts, application trackers, and writing samples as source material.
- Never invent experience, credentials, employers, degrees, dates, skills, metrics, compensation, or application status.
- When a job requirement is not supported by the user's materials, say so and suggest an honest adjacent framing or a concrete gap-mitigation step.
- Preserve the user's voice when drafting candidate-facing text. If writing samples are available, follow their tone and structure without copying sentences.

Resume and application guidance:
- Map job requirements to real proof points from the user's materials.
- Prefer measurable achievements, concrete tools, scope, and outcomes over generic claims.
- Use the language and seniority implied by the job description, but do not overstate the user's background.
- Keep ATS-facing resume content clean, single-column friendly, keyword-aware, and truthful.
- For cover letters, application answers, LinkedIn messages, and follow-ups: be concise, confident without arrogance, specific to the company or role, and avoid corporate cliches.
- Do not submit applications or imply that an application was submitted unless the user explicitly confirms it.

Job evaluation guidance:
- Help the user prioritize time. Call out strong matches, weak matches, red flags, missing information, and practical next steps.
- Separate observations from speculation. If you infer something from a job description or document, label it as an inference.
- For compensation, market, company news, or current hiring signals, say when current external research would be needed instead of guessing.
- You can access public job-ad URLs through the fetch_web_page tool. Never tell the user you cannot access external websites when a public HTTP(S) job URL is provided; call fetch_web_page instead. If the tool fails, report the tool error and ask for pasted text only then.
- When the user provides a public job-ad URL, call fetch_web_page before asking them to paste the job description. Use the simplified page text as source material for role title, company, requirements, and next steps.
- When the user gives you a job ad or job-ad URL and asks to track, create, start, save, or evaluate it, be action-first. If the fetched or provided job text gives you a clear company and role title, create the employer with create_company if you do not already have a company_id, then create the application with create_application using the role title as the application name, the company_id from create_company, the fetched job description text as job_description_text, and the job URL as job_description_url. Do this before asking for resumes, CVs, portfolios, notes, or other candidate materials.
- Missing candidate materials are not a blocker to tracking an application. After the application is created, briefly summarize the role from the job description and ask for resume/CV or other materials only as optional next context for fit analysis, tailoring, or interview preparation.
- Ask clarifying questions before creating an application only when the company or role title cannot be determined from the job text, or when the user explicitly says they only want analysis and do not want the role tracked. Do not claim the application was submitted; only say it was tracked locally and that the job description was saved to the application.
- Avoid duplicate companies. The create_company tool searches existing companies by name. If it returns reused_existing=true, use that company_id for the application. If it returns requires_confirmation=true with a similar_company_id, reuse similar_company_id unless the user explicitly confirms the requested name should be a separate company. Do not call create_company with confirm_new=true on your own.
- When an application's company is "Unknown Company", that means it was created before the real employer was identified. As soon as you can identify the real company from the job description or other materials (page title, posting body, application notes), call set_application_company with the application_id and the identified company_name to move the application off the Unknown placeholder. The same dedupe rules as create_company apply — reuse similar_company_id when offered, do not pass confirm_new=true without explicit user confirmation. Never delete or rename the Unknown company itself; only move applications away from it.

Document citation instructions:
- Cite local documents only when document context is provided and you make a specific claim from that context.
- Use numbered inline markers [1], [2], etc. at the point of the claim.
- At the end of the response, append a <CITATIONS> block containing a JSON array with one entry per marker:

<CITATIONS>
[
  {"ref": 1, "doc_id": "document_id from the tool result", "page": 1, "quote": "exact short text from the document"}
]
</CITATIONS>

- The marker number is the citation ref, not a page number.
- Use the exact local document_id from tool results in citation JSON. In prose, refer to documents by filename or plain description, never by document_id.
- Keep quotes short and verbatim. Omit the <CITATIONS> block if there are no document citations.

Response style:
- Be precise, useful, and candid.
- Avoid fluff, emojis, and generic encouragement.
- Ask for missing source material only when the task cannot be completed honestly without it.`

type chatRequestMessage struct {
	Role     string               `json:"role"`
	Content  string               `json:"content"`
	Files    []chatRequestFile    `json:"files"`
	Workflow *chatRequestWorkflow `json:"workflow"`
}

type chatRequestFile struct {
	Filename   string `json:"filename"`
	DocumentID string `json:"document_id"`
}

type chatRequestWorkflow struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type completionRequest struct {
	Model        string
	SystemPrompt string
	User         string
}

func modelOrDefault(model *string) string {
	if model != nil && strings.TrimSpace(*model) != "" {
		return strings.TrimSpace(*model)
	}
	return defaultMainModel
}

func (s *Server) completeText(ctx context.Context, req completionRequest) (string, error) {
	model := req.Model
	if model == "" {
		model = defaultTitleModel
	}
	ctx, span := startLocalSpan(ctx, "llm.complete_text",
		attribute.String("llm.model", model),
		attribute.Int("llm.user_chars", len(req.User)),
		attribute.Int("llm.system_prompt_chars", len(req.SystemPrompt)),
	)
	defer span.End()
	if os.Getenv(mockProviderEnvVar) == "1" {
		span.SetAttributes(attribute.Bool("llm.mock", true))
		return mockCompletion(req.User), nil
	}
	if strings.HasPrefix(model, "claude") || strings.HasPrefix(model, "gemini") {
		err := fmt.Errorf("%s provider is configured but hosted provider calls are disabled in local M4", model)
		recordSpanError(span, err)
		return "", err
	}
	span.SetAttributes(attribute.String("llm.model", model))
	body := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": req.SystemPrompt},
			{"role": "user", "content": req.User},
		},
		"stream": false,
	}
	var response struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Error string `json:"error"`
	}
	if err := postOllama(ctx, body, &response); err != nil {
		recordSpanError(span, err)
		return "", err
	}
	if response.Error != "" {
		err := fmt.Errorf("ollama error: %s", response.Error)
		recordSpanError(span, err)
		return "", err
	}
	span.SetAttributes(attribute.Int("llm.response_chars", len(response.Message.Content)))
	return response.Message.Content, nil
}

func postOllama(ctx context.Context, body map[string]any, target any) error {
	attrs := []attribute.KeyValue{attribute.String("http.method", http.MethodPost)}
	if model, ok := body["model"].(string); ok {
		attrs = append(attrs, attribute.String("llm.model", model))
	}
	if messages, ok := body["messages"].([]ollamaMessage); ok {
		attrs = append(attrs, attribute.Int("llm.message_count", len(messages)))
	} else if messages, ok := body["messages"].([]map[string]string); ok {
		attrs = append(attrs, attribute.Int("llm.message_count", len(messages)))
	}
	if tools, ok := body["tools"].([]map[string]any); ok {
		attrs = append(attrs, attribute.Int("llm.tool_count", len(tools)))
	}
	_, span := startLocalSpan(ctx, "ollama.chat", attrs...)
	defer span.End()
	data, err := json.Marshal(body)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	span.SetAttributes(attribute.Int("http.request_content_length", len(data)))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, ollamaBaseURL()+"/api/chat", bytes.NewReader(data))
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	defer func() { _ = response.Body.Close() }()
	span.SetAttributes(attribute.Int("http.status_code", response.StatusCode))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		buf, _ := ioReadAllLimit(response.Body, 4096)
		err := fmt.Errorf("ollama request failed (%d): %s", response.StatusCode, string(buf))
		recordSpanError(span, err)
		return err
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		recordSpanError(span, err)
		return err
	}
	return nil
}

// streamOllamaChat issues a streaming /api/chat request to Ollama and
// reassembles the response. onThinkingDelta is invoked for every non-empty
// message.thinking chunk; onContentDelta is invoked for every non-empty
// message.content chunk. The aggregated final message (with full content,
// thinking, and any tool_calls observed) is decoded into target.
//
// body should NOT pre-set "stream"; this function forces stream=true.
func streamOllamaChat(ctx context.Context, body map[string]any, onThinkingDelta, onContentDelta func(string), target *ollamaChatResponse) error {
	body["stream"] = true
	attrs := []attribute.KeyValue{attribute.String("http.method", http.MethodPost)}
	if model, ok := body["model"].(string); ok {
		attrs = append(attrs, attribute.String("llm.model", model))
	}
	if messages, ok := body["messages"].([]ollamaMessage); ok {
		attrs = append(attrs, attribute.Int("llm.message_count", len(messages)))
	}
	if tools, ok := body["tools"].([]map[string]any); ok {
		attrs = append(attrs, attribute.Int("llm.tool_count", len(tools)))
	}
	_, span := startLocalSpan(ctx, "ollama.chat", attrs...)
	defer span.End()
	data, err := json.Marshal(body)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	span.SetAttributes(attribute.Int("http.request_content_length", len(data)))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, ollamaBaseURL()+"/api/chat", bytes.NewReader(data))
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	defer func() { _ = response.Body.Close() }()
	span.SetAttributes(attribute.Int("http.status_code", response.StatusCode))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		buf, _ := ioReadAllLimit(response.Body, 4096)
		err := fmt.Errorf("ollama request failed (%d): %s", response.StatusCode, string(buf))
		recordSpanError(span, err)
		return err
	}
	var (
		contentBuf          strings.Builder
		thinkingBuf         strings.Builder
		role                string
		toolCalls           []ollamaToolCall
		streamStart         = time.Now()
		chunkCount          int
		thinkingChunks      int
		contentChunks       int
		firstChunkAt        time.Time
		firstContentChunkAt time.Time
		lastChunkAt         time.Time
		maxChunkGap         time.Duration
	)
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var chunk struct {
			Message struct {
				Role      string           `json:"role"`
				Content   string           `json:"content"`
				Thinking  string           `json:"thinking"`
				ToolCalls []ollamaToolCall `json:"tool_calls"`
			} `json:"message"`
			Done  bool   `json:"done"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal(line, &chunk); err != nil {
			recordSpanError(span, err)
			return err
		}
		if chunk.Error != "" {
			target.Error = chunk.Error
			return nil
		}
		now := time.Now()
		if firstChunkAt.IsZero() {
			firstChunkAt = now
		} else {
			gap := now.Sub(lastChunkAt)
			if gap > maxChunkGap {
				maxChunkGap = gap
			}
		}
		lastChunkAt = now
		chunkCount++
		if chunk.Message.Role != "" {
			role = chunk.Message.Role
		}
		if chunk.Message.Thinking != "" {
			thinkingBuf.WriteString(chunk.Message.Thinking)
			thinkingChunks++
			if onThinkingDelta != nil {
				onThinkingDelta(chunk.Message.Thinking)
			}
		}
		if chunk.Message.Content != "" {
			contentBuf.WriteString(chunk.Message.Content)
			contentChunks++
			if firstContentChunkAt.IsZero() {
				firstContentChunkAt = now
			}
			if onContentDelta != nil {
				onContentDelta(chunk.Message.Content)
			}
		}
		if len(chunk.Message.ToolCalls) > 0 {
			toolCalls = append(toolCalls, chunk.Message.ToolCalls...)
		}
	}
	if err := scanner.Err(); err != nil {
		recordSpanError(span, err)
		return err
	}
	target.Message.Role = role
	target.Message.Content = contentBuf.String()
	target.Message.Thinking = thinkingBuf.String()
	target.Message.ToolCalls = toolCalls
	span.SetAttributes(
		attribute.Int("llm.response_chars", len(target.Message.Content)),
		attribute.Int("llm.thinking_chars", len(target.Message.Thinking)),
		attribute.Int("llm.tool_call_count", len(toolCalls)),
		attribute.Int("llm.stream.chunk_count", chunkCount),
		attribute.Int("llm.stream.thinking_chunk_count", thinkingChunks),
		attribute.Int("llm.stream.content_chunk_count", contentChunks),
		attribute.Float64("llm.stream.max_chunk_gap_ms", float64(maxChunkGap.Milliseconds())),
	)
	if !firstChunkAt.IsZero() {
		span.SetAttributes(
			attribute.Float64("llm.stream.time_to_first_chunk_ms", float64(firstChunkAt.Sub(streamStart).Milliseconds())),
			attribute.Float64("llm.stream.time_to_last_chunk_ms", float64(lastChunkAt.Sub(streamStart).Milliseconds())),
		)
	}
	if !firstContentChunkAt.IsZero() {
		span.SetAttributes(attribute.Float64(
			"llm.stream.time_to_first_content_chunk_ms",
			float64(firstContentChunkAt.Sub(streamStart).Milliseconds()),
		))
	}
	return nil
}

func ollamaBaseURL() string {
	base := os.Getenv("OLLAMA_BASE_URL")
	if base == "" {
		base = defaultOllamaURL
	}
	return strings.TrimRight(base, "/")
}

func mockCompletion(user string) string {
	lower := strings.ToLower(user)
	if strings.Contains(lower, "column title:") {
		return `{"prompt":"Extract the requested value from the document."}`
	}
	if strings.Contains(lower, "generate a concise title") {
		return "Mock Chat Title"
	}
	// Document metadata classifier user message always opens with
	// "Filename: ...\n\nContent: ...". Mock a plausible interview-transcript
	// response so probe scenarios get a deterministic happy path with
	// LUKE_MOCK_LLM=1, without needing a running Ollama.
	if strings.HasPrefix(user, "Filename:") {
		return `{"kind":"interview_transcript","library":false,"library_kind":null,"interview_stage":"recruiter","summary":"Mocked classifier output for probe scenarios. The document looks like an interview transcript.","topics":["mock","probe","interview"],"company_refs":["Mock Co"],"people_refs":[{"name":"Mock Interviewer","role":"Recruiter"}],"dated_event_at":null,"suggested_application_match":null,"suggested_derived_from":null}`
	}
	return "Mock completion"
}

func ioReadAllLimit(reader io.Reader, limit int64) ([]byte, error) {
	return io.ReadAll(io.LimitReader(reader, limit))
}
