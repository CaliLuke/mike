package localapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"go.opentelemetry.io/otel/attribute"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
)

// executeAttachDocumentToApplication writes a document_application_links
// row tying an existing library document to an application. Idempotent:
// when the (document, application) pair already exists, returns the
// existing link id rather than an error.
func (s *Server) executeAttachDocumentToApplication(ctx context.Context, call *planner.ToolRequest, _ func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()

	payload, err := careercontext.UnmarshalAttachDocumentToApplicationPayload([]byte(call.Payload))
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	docID := trimRecord(strings.TrimSpace(payload.DocumentID))
	appID := trimRecord(strings.TrimSpace(payload.ApplicationID))
	if docID == "" {
		return recordToolFailure(span, call.Name, fmt.Errorf("document_id is required")), nil
	}
	if appID == "" {
		return recordToolFailure(span, call.Name, fmt.Errorf("application_id is required")), nil
	}
	span.SetAttributes(
		attribute.String("document.id", docID),
		attribute.String("application.id", appID),
	)

	// Look for an existing link first so we stay idempotent.
	existing, err := queryRows(ctx, s.app.DB, fmt.Sprintf(
		"SELECT id FROM document_application_links WHERE document_id = %s AND application_id = %s LIMIT 1;",
		recordID("documents", docID),
		recordID("applications", appID),
	))
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	if len(existing) > 0 {
		linkID := trimRecord(asString(existing[0]["id"]))
		span.SetAttributes(
			attribute.String("link.id", linkID),
			attribute.Bool("link.already_existed", true),
		)
		ok := true
		return &planner.ToolResult{
			Name: call.Name,
			Result: &careercontext.AttachDocumentToApplicationResult{
				OK:     &ok,
				LinkID: stringPtr(linkID),
			},
		}, nil
	}

	linkID := newID("doclink")
	_, err = s.app.DB.Query(ctx, fmt.Sprintf(
		`CREATE %s CONTENT {
			document_id: %s,
			application_id: %s,
			relation: "referenced",
			created_at: time::now(),
			created_by: "assistant_tool"
		};`,
		recordID("document_application_links", linkID),
		recordID("documents", docID),
		recordID("applications", appID),
	))
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	span.SetAttributes(
		attribute.String("link.id", linkID),
		attribute.Bool("link.already_existed", false),
	)
	ok := true
	return &planner.ToolResult{
		Name: call.Name,
		Result: &careercontext.AttachDocumentToApplicationResult{
			OK:     &ok,
			LinkID: stringPtr(linkID),
		},
	}, nil
}
