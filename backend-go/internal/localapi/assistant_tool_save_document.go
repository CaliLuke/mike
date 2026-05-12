package localapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"go.opentelemetry.io/otel/attribute"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
)

// executeSaveDocument persists arbitrary text/markdown as a new
// document, optionally attached to an application. Backs the agent's
// "save this fetched job description" flow without forcing it through
// create_application (which would create a sibling app).
//
// The underlying helper is the same one create_application's JD-save
// uses (createAssistantDocument with source="job_description") — this
// tool just exposes it standalone with the application_id explicit
// instead of implicit.
func (s *Server) executeSaveDocument(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()

	payload, err := careercontext.UnmarshalSaveDocumentPayload([]byte(call.Payload))
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	filename := strings.TrimSpace(payload.Filename)
	if filename == "" {
		return recordToolFailure(span, call.Name, fmt.Errorf("filename is required")), nil
	}
	body := payload.Body
	if strings.TrimSpace(body) == "" {
		return recordToolFailure(span, call.Name, fmt.Errorf("body is required")), nil
	}
	kind := strings.TrimSpace(derefString(payload.Kind))
	format := strings.TrimSpace(strings.ToLower(derefString(payload.Format)))
	if format == "" {
		format = "md"
	}
	if format != "md" && format != "txt" {
		return recordToolFailure(span, call.Name,
			fmt.Errorf("unsupported format %q (allowed: md, txt)", format)), nil
	}
	appID := strings.TrimSpace(derefString(payload.ApplicationID))
	var applicationIDPtr *string
	if appID != "" {
		canonical := trimRecord(appID)
		applicationIDPtr = &canonical
	}
	span.SetAttributes(
		attribute.String("document.filename", filename),
		attribute.String("document.kind", kind),
		attribute.String("document.format", format),
		attribute.Int("document.body_chars", len(body)),
		attribute.Bool("document.has_application", applicationIDPtr != nil),
	)

	doc, err := s.createAssistantDocument(ctx, filename, format, []byte(body), kind, applicationIDPtr)
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	span.SetAttributes(
		attribute.String("document.id", doc.DocumentID),
		attribute.String("document.download_url", doc.DownloadURL),
	)

	// Emit the same `doc_created` SSE event the create_application
	// path emits so the frontend's existing tool UI renders a
	// download card for the saved doc.
	_ = send(map[string]any{
		"type":         "doc_created",
		"filename":     doc.Filename,
		"download_url": doc.DownloadURL,
		"document_id":  doc.DocumentID,
		"version_id":   doc.VersionID,
	})

	ok := true
	return &planner.ToolResult{
		Name: call.Name,
		Result: &careercontext.SaveDocumentResult{
			OK:            &ok,
			DocumentID:    stringPtr(doc.DocumentID),
			Filename:      stringPtr(doc.Filename),
			ApplicationID: applicationIDPtr,
			DownloadURL:   stringPtr(doc.DownloadURL),
		},
	}, nil
}
