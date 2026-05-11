// Package probe is the toolkit used by cmd/probe to drive end-to-end
// scenarios against a running Luke backend and assert results from the
// telemetry SQLite database. The probe runner is *not* a unit-test
// framework — it talks to the live backend via HTTP/SSE, like a user
// would, and verifies behaviour from the outside.
package probe

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
)

// Client is a thin HTTP wrapper aimed at probe scenarios. It does not pool
// connections deliberately — each call gets its own request so failures stay
// observable.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

// NewClient honours LUKE_BACKEND_ADDR (the same env var the backend itself
// reads) so the probe and the backend always agree on where to talk.
func NewClient() *Client {
	addr := os.Getenv("LUKE_BACKEND_ADDR")
	if addr == "" {
		addr = "127.0.0.1:3002"
	}
	return &Client{
		BaseURL: "http://" + addr,
		HTTP:    &http.Client{Timeout: 0}, // SSE needs unbounded read
	}
}

// Do executes a request and returns the response body as bytes. Non-2xx
// statuses produce an error containing the body, which is exactly what a
// debugging operator wants to see.
func (c *Client) Do(ctx context.Context, method, path string, body any) ([]byte, int, error) {
	var reqBody io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal %s %s: %w", method, path, err)
		}
		reqBody = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reqBody)
	if err != nil {
		return nil, 0, err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if resp.StatusCode/100 != 2 {
		return data, resp.StatusCode, fmt.Errorf("%s %s -> HTTP %d: %s", method, path, resp.StatusCode, string(data))
	}
	return data, resp.StatusCode, nil
}

// GetJSON does a GET and decodes the JSON body into out.
func (c *Client) GetJSON(ctx context.Context, path string, out any) error {
	data, _, err := c.Do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(data, out)
}

// PostJSON does a POST with a JSON body and decodes the JSON response into
// out (which may be nil to discard).
func (c *Client) PostJSON(ctx context.Context, path string, body, out any) error {
	data, _, err := c.Do(ctx, http.MethodPost, path, body)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(data, out)
}

// Patch sends a PATCH with a JSON body and decodes the response.
func (c *Client) Patch(ctx context.Context, path string, body, out any) error {
	data, _, err := c.Do(ctx, http.MethodPatch, path, body)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(data, out)
}

// Delete sends a DELETE and ignores the response body.
func (c *Client) Delete(ctx context.Context, path string) error {
	_, _, err := c.Do(ctx, http.MethodDelete, path, nil)
	return err
}

// SSEEvent is one parsed event in an `event-stream` response.
type SSEEvent struct {
	Type    string         // value of the "event:" field, default "message"
	Payload map[string]any // parsed JSON body, or nil if not JSON
	Raw     string         // original data line(s) joined
}

// StreamSSE opens an SSE endpoint with method (POST/GET) and calls handle for
// each event as it arrives. Returns when the server closes the stream, the
// handle returns an error, or ctx is cancelled. The probe relies on the
// backend emitting a final `{"type":"done"}` event to know it's complete.
func (c *Client) StreamSSE(ctx context.Context, method, path string, body any, handle func(SSEEvent) error) error {
	var reqBody io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reqBody = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reqBody)
	if err != nil {
		return err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s %s -> HTTP %d: %s", method, path, resp.StatusCode, string(data))
	}

	reader := bufio.NewReaderSize(resp.Body, 64*1024)
	var (
		eventType    = "message"
		dataLines    []string
		flushOnBlank = func() error {
			if len(dataLines) == 0 {
				eventType = "message"
				return nil
			}
			rawData := strings.Join(dataLines, "\n")
			ev := SSEEvent{Type: eventType, Raw: rawData}
			var parsed map[string]any
			if err := json.Unmarshal([]byte(rawData), &parsed); err == nil {
				ev.Payload = parsed
			}
			dataLines = dataLines[:0]
			eventType = "message"
			return handle(ev)
		}
	)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		line, err := reader.ReadString('\n')
		if err != nil && err != io.EOF {
			return err
		}
		stripped := strings.TrimRight(line, "\r\n")
		if stripped == "" {
			if err := flushOnBlank(); err != nil {
				return err
			}
			if err == io.EOF {
				return nil
			}
			continue
		}
		switch {
		case strings.HasPrefix(stripped, "event:"):
			eventType = strings.TrimSpace(stripped[len("event:"):])
		case strings.HasPrefix(stripped, "data:"):
			dataLines = append(dataLines, strings.TrimSpace(stripped[len("data:"):]))
		case strings.HasPrefix(stripped, ":"):
			// comment / keepalive — ignore.
		}
		if err == io.EOF {
			if flushErr := flushOnBlank(); flushErr != nil {
				return flushErr
			}
			return nil
		}
	}
}

// Now returns the current time, captured at probe-start to bound telemetry
// queries to "spans created by this run".
func Now() time.Time { return time.Now() }
