package localapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"go.opentelemetry.io/otel/attribute"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
)

// executeDeleteDocument removes a document. The /single-documents
// DELETE handler does the same thing — this exposes it as a tool the
// agent can invoke directly after the user confirms. Irreversible.
func (s *Server) executeDeleteDocument(ctx context.Context, call *planner.ToolRequest, _ func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()

	payload, err := careercontext.UnmarshalDeleteDocumentPayload([]byte(call.Payload))
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	docID := trimRecord(strings.TrimSpace(payload.DocumentID))
	if docID == "" {
		return recordToolFailure(span, call.Name, fmt.Errorf("document_id is required")), nil
	}
	span.SetAttributes(attribute.String("document.id", docID))

	// Mirror the order of the HTTP delete handler: links → versions →
	// the document record itself. Each step is fire-and-forget at this
	// level; failures bubble up.
	if _, err := s.app.DB.Query(ctx, fmt.Sprintf(
		"DELETE FROM document_application_links WHERE document_id = %s;",
		recordID("documents", docID),
	)); err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	if _, err := s.app.DB.Query(ctx, fmt.Sprintf(
		"DELETE FROM document_versions WHERE document_id = %s;",
		recordID("documents", docID),
	)); err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	if _, err := s.app.DB.Query(ctx, fmt.Sprintf(
		"DELETE FROM documents WHERE id = %s;",
		recordID("documents", docID),
	)); err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}

	ok := true
	return &planner.ToolResult{
		Name: call.Name,
		Result: &careercontext.DeleteDocumentResult{
			OK: &ok,
		},
	}, nil
}
