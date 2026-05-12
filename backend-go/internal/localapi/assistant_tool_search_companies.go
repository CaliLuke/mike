package localapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"go.opentelemetry.io/otel/attribute"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
)

const searchCompaniesDefaultLimit = 8

// executeSearchCompanies surfaces existing companies to the agent so it
// can decide whether to reuse one before calling create_company. Empty
// query → most-recent companies. Non-empty query → fuzzy match via
// the same `findSimilarCompanies` helper the dedupe-warning code uses.
func (s *Server) executeSearchCompanies(ctx context.Context, call *planner.ToolRequest, _ func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startCareerToolSpan(ctx, call)
	defer span.End()

	payload, err := careercontext.UnmarshalSearchCompaniesPayload([]byte(call.Payload))
	if err != nil {
		return recordToolFailure(span, call.Name, err), nil
	}
	query := strings.TrimSpace(derefString(payload.Query))
	limit := searchCompaniesDefaultLimit
	if payload.Limit != nil && *payload.Limit > 0 {
		limit = *payload.Limit
	}
	span.SetAttributes(
		attribute.String("search.query", query),
		attribute.Int("search.limit", limit),
	)

	companies := make([]*careercontext.AssistantCompanyRef, 0)
	if query == "" {
		// Recency listing — falls back to the same projection used by
		// the /companies endpoint so the agent gets stable fields.
		rows, err := queryRows(ctx, s.app.DB, fmt.Sprintf(
			"SELECT id, name, website FROM companies ORDER BY created_at DESC LIMIT %d;",
			limit,
		))
		if err != nil {
			return recordToolFailure(span, call.Name, err), nil
		}
		for _, row := range rows {
			ref := companyRefFromRow(row, 0, false)
			companies = append(companies, &ref)
		}
	} else {
		matches, err := s.findSimilarCompanies(ctx, query)
		if err != nil {
			return recordToolFailure(span, call.Name, err), nil
		}
		for i, m := range matches {
			if i >= limit {
				break
			}
			similarity := m.Similarity
			exact := m.ExactKey
			companies = append(companies, &careercontext.AssistantCompanyRef{
				CompanyID:  stringPtr(m.ID),
				Name:       stringPtr(m.Name),
				Website:    stringPtr(m.Website),
				Similarity: &similarity,
				ExactKey:   &exact,
			})
		}
	}
	span.SetAttributes(attribute.Int("search.result_count", len(companies)))

	ok := true
	return &planner.ToolResult{
		Name: call.Name,
		Result: &careercontext.SearchCompaniesResult{
			OK:        &ok,
			Companies: companies,
		},
	}, nil
}

func companyRefFromRow(row map[string]any, similarity float64, exactKey bool) careercontext.AssistantCompanyRef {
	id := trimRecord(asString(row["id"]))
	name := asString(row["name"])
	website := asString(row["website"])
	out := careercontext.AssistantCompanyRef{
		CompanyID: stringPtr(id),
		Name:      stringPtr(name),
		Website:   stringPtr(website),
	}
	if similarity > 0 {
		out.Similarity = &similarity
	}
	if exactKey {
		out.ExactKey = &exactKey
	}
	return out
}
