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
)

const (
	defaultMainModel   = "gemma4"
	defaultTitleModel  = "gemma4"
	defaultOllamaURL   = "http://localhost:11434"
	mockProviderEnvVar = "LUKE_MOCK_LLM"
)

type chatRequestMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
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

func (s *Server) streamChatText(ctx context.Context, model string, messages []chatRequestMessage, onDelta func(string) error) (string, error) {
	if os.Getenv(mockProviderEnvVar) == "1" {
		text := "Mock provider response.\n\n<CITATIONS>[]</CITATIONS>"
		if err := onDelta(text); err != nil {
			return "", err
		}
		return text, nil
	}
	if strings.HasPrefix(model, "claude") || strings.HasPrefix(model, "gemini") {
		return "", fmt.Errorf("%s provider is configured but hosted provider calls are disabled in local M4", model)
	}
	bodyMessages := make([]map[string]string, 0, len(messages)+1)
	bodyMessages = append(bodyMessages, map[string]string{
		"role":    "system",
		"content": "You are Luke, a local AI workbench assistant. Answer concisely and cite local documents only when context is provided.",
	})
	for _, message := range messages {
		role := message.Role
		if role == "" {
			role = "user"
		}
		bodyMessages = append(bodyMessages, map[string]string{
			"role":    role,
			"content": message.Content,
		})
	}
	body := map[string]any{
		"model":    model,
		"messages": bodyMessages,
		"stream":   true,
		"options": map[string]any{
			"temperature": 1,
			"top_p":       0.95,
			"top_k":       64,
		},
	}
	data, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, ollamaBaseURL()+"/api/chat", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		buf, _ := ioReadAllLimit(response.Body, 4096)
		return "", fmt.Errorf("ollama request failed (%d): %s", response.StatusCode, string(buf))
	}
	var full strings.Builder
	scanner := bufio.NewScanner(response.Body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var chunk struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			return full.String(), err
		}
		if chunk.Error != "" {
			return full.String(), fmt.Errorf("ollama error: %s", chunk.Error)
		}
		if chunk.Message.Content != "" {
			full.WriteString(chunk.Message.Content)
			if err := onDelta(chunk.Message.Content); err != nil {
				return full.String(), err
			}
		}
	}
	return full.String(), scanner.Err()
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
