package localapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
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
	if os.Getenv(mockProviderEnvVar) == "1" {
		return mockCompletion(req.User), nil
	}
	model := req.Model
	if model == "" {
		model = defaultTitleModel
	}
	if strings.HasPrefix(model, "claude") || strings.HasPrefix(model, "gemini") {
		return "", fmt.Errorf("%s provider is configured but hosted provider calls are disabled in local M4", model)
	}
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
		return "", err
	}
	if response.Error != "" {
		return "", fmt.Errorf("ollama error: %s", response.Error)
	}
	return response.Message.Content, nil
}

func postOllama(ctx context.Context, body map[string]any, target any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, ollamaBaseURL()+"/api/chat", bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		buf, _ := ioReadAllLimit(response.Body, 4096)
		return fmt.Errorf("ollama request failed (%d): %s", response.StatusCode, string(buf))
	}
	return json.NewDecoder(response.Body).Decode(target)
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
	return "Mock completion"
}

func ioReadAllLimit(reader io.Reader, limit int64) ([]byte, error) {
	return io.ReadAll(io.LimitReader(reader, limit))
}
