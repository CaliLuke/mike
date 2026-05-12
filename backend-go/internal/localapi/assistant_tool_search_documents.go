package localapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"go.opentelemetry.io/otel/attribute"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
)

const searchDocumentsDefaultLimit = 20

// executeSearchDocuments lets the agent look up documents by filename
// substring and/or scope (application_id, kind). Used to locate
// existing resumes, job descriptions, etc. without listing every
// document in the workbench.
func (s *Server) executeSearchDocuments(ctx context.Context, call *planner.ToolRequest, _ func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()

	payload, err := careercontext.UnmarshalSearchDocumentsPayload([]byte(call.Payload))
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	query := strings.TrimSpace(derefString(payload.Query))
	appID := strings.TrimSpace(derefString(payload.ApplicationID))
	kind := strings.TrimSpace(derefString(payload.Kind))
	limit := searchDocumentsDefaultLimit
	if payload.Limit != nil && *payload.Limit > 0 {
		limit = *payload.Limit
	}
	span.SetAttributes(
		attribute.String("search.query", query),
		attribute.String("search.application_id", appID),
		attribute.String("search.kind", kind),
		attribute.Int("search.limit", limit),
	)

	wheres := []string{"true"}
	if appID != "" {
		wheres = append(wheres, "application_id = "+recordID("applications", appID))
	}
	if kind != "" {
		wheres = append(wheres, "kind = "+surrealString(kind))
	}
	if query != "" {
		wheres = append(wheres, "string::contains(string::lowercase(filename), "+surrealString(strings.ToLower(query))+")")
	}
	q := fmt.Sprintf(
		"SELECT id, filename, kind, application_id, file_type, summary FROM documents WHERE %s ORDER BY created_at DESC LIMIT %d;",
		strings.Join(wheres, " AND "),
		limit,
	)
	rows, err := queryRows(ctx, s.app.DB, q)
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	docs := make([]*careercontext.AssistantDocumentSummary, 0, len(rows))
	for _, row := range rows {
		docs = append(docs, &careercontext.AssistantDocumentSummary{
			DocumentID:    stringPtr(trimRecord(asString(row["id"]))),
			Filename:      stringPtr(asString(row["filename"])),
			Kind:          stringPtr(asString(row["kind"])),
			ApplicationID: stringPtr(trimRecord(asString(row["application_id"]))),
			FileType:      stringPtr(asString(row["file_type"])),
			Summary:       stringPtr(asString(row["summary"])),
		})
	}
	span.SetAttributes(attribute.Int("search.result_count", len(docs)))

	ok := true
	return &planner.ToolResult{
		Name: call.Name,
		Result: &careercontext.SearchDocumentsResult{
			OK:        &ok,
			Documents: docs,
		},
	}, nil
}
