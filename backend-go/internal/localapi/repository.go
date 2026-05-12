package localapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/CaliLuke/luke/backend-go/internal/localdata"
	"github.com/CaliLuke/luke/backend-go/internal/persistence"
)

type documentVersionRef struct {
	ID          string
	StoragePath string
	Filename    string
}

type workflowPayload struct {
	Title           string           `json:"title"`
	Type            string           `json:"type"`
	PromptMd        *string          `json:"prompt_md"`
	ColumnsConfig   []map[string]any `json:"columns_config"`
	Practice        *string          `json:"practice"`
	RowMode         *string          `json:"row_mode"`         // "document" | "entity"
	AnchorExtractor map[string]any   `json:"anchor_extractor"` // { prompt, anchor_schema? }
}

type tabularPayload struct {
	Title           *string          `json:"title"`
	DocumentIDs     []string         `json:"document_ids"`
	ColumnsConfig   []map[string]any `json:"columns_config"`
	WorkflowID      *string          `json:"workflow_id"`
	ApplicationID   *string          `json:"application_id"`
	SharedWith      []string         `json:"shared_with"`
	RowMode         *string          `json:"row_mode"`         // copied from workflow at create
	AnchorExtractor map[string]any   `json:"anchor_extractor"` // copied from workflow at create
}

const applicationListQuery = `
SELECT
	id, user_id, true AS is_owner, company_id, company_id.name AS company_name, name, job_description_url, status, shared_with, created_at, updated_at,
	(SELECT id, application_id, parent_folder_id, name, created_at, updated_at FROM application_folders WHERE application_id = $parent.id ORDER BY created_at) AS folders,
	count(SELECT 1 FROM documents WHERE application_id = $parent.id) AS document_count,
	count(SELECT 1 FROM chats WHERE application_id = $parent.id) AS chat_count,
	count(SELECT 1 FROM tabular_reviews WHERE application_id = $parent.id) AS review_count,
	(SELECT
		document_id.id AS id,
		document_id.filename AS filename,
		document_id.file_type AS file_type,
		document_id.kind AS kind,
		document_id.library AS library,
		document_id.library_kind AS library_kind,
		document_id.summary AS summary,
		document_id.topics AS topics,
		document_id.metadata_status AS metadata_status,
		document_id.updated_at AS updated_at,
		created_at
		FROM document_application_links
		WHERE application_id = $parent.id
		ORDER BY created_at DESC) AS library_documents
FROM applications ORDER BY updated_at DESC;`

const companyListQuery = `
SELECT
	id, user_id, name, website, job_board_identities, created_at, updated_at,
	count(SELECT VALUE id FROM applications WHERE company_id = $parent.id) AS application_count
FROM companies ORDER BY name;`

type companySimilarityMatch struct {
	ID            string
	Name          string
	Website       string
	Similarity    float64
	NormalizedKey string
	ExactKey      bool
}

const companySimilarityThreshold = 0.86

func (s *Server) createCompany(ctx context.Context, name string, website *string) (map[string]any, error) {
	return s.createCompanyWithIdentities(ctx, name, website, nil)
}

// createCompanyWithIdentities is the full-shape constructor used when the
// caller has already identified one or more job-board identities (e.g. from
// parsing a Greenhouse/Lever posting URL). Pass nil identities for the
// common case — createCompany is the shorthand for that.
func (s *Server) createCompanyWithIdentities(ctx context.Context, name string, website *string, identities []string) (map[string]any, error) {
	id := newID("company")
	identitiesSurreal := "NONE"
	if len(identities) > 0 {
		quoted := make([]string, len(identities))
		for i, ident := range identities {
			quoted[i] = surrealString(ident)
		}
		identitiesSurreal = "[" + strings.Join(quoted, ", ") + "]"
	}
	_, err := s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			user_id: users:local,
			name: %s,
			website: %s,
			job_board_identities: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, recordID("companies", id), surrealString(name), optionStringPtr(website), identitiesSurreal))
	if err != nil {
		return nil, err
	}
	return s.getCompany(ctx, id)
}

func (s *Server) findSimilarCompanies(ctx context.Context, name string) ([]companySimilarityMatch, error) {
	ctx, span := startLocalSpan(ctx, "company.similarity_search")
	defer span.End()
	needleKey := companySearchKey(name)
	span.SetAttributes(
		attribute.String("company.requested_name", name),
		attribute.String("company.normalized_key", needleKey),
		attribute.Float64("company.similarity_threshold", companySimilarityThreshold),
	)
	if needleKey == "" {
		span.SetAttributes(attribute.String("company.similarity_search.skip_reason", "empty_normalized_key"))
		return nil, nil
	}
	searchText := strings.Join(companySearchTerms(name), " ")
	span.SetAttributes(attribute.String("company.search_text", searchText))
	rows, err := queryRows(ctx, s.app.DB, fmt.Sprintf(`
SELECT
	id,
	name,
	website,
	search::score(1) AS ft_score,
	string::similarity::jaro(string::lowercase(name), %s) AS similarity
FROM companies
WHERE name @1@ %s OR string::similarity::jaro(string::lowercase(name), %s) >= %f
ORDER BY ft_score DESC, similarity DESC, name
LIMIT 8;
`,
		surrealString(strings.ToLower(strings.TrimSpace(name))),
		surrealString(searchText),
		surrealString(strings.ToLower(strings.TrimSpace(name))),
		companySimilarityThreshold,
	))
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	span.SetAttributes(attribute.Int("company.similarity_search.raw_result_count", len(rows)))
	matches := make([]companySimilarityMatch, 0, len(rows))
	for _, row := range rows {
		candidateName := asString(row["name"])
		candidateKey := companySearchKey(candidateName)
		similarity := asFloat64(row["similarity"])
		exactKey := needleKey != "" && candidateKey == needleKey
		candidateAttrs := []attribute.KeyValue{
			attribute.String("company.candidate.id", trimRecord(asString(row["id"]))),
			attribute.String("company.candidate.name", candidateName),
			attribute.String("company.candidate.normalized_key", candidateKey),
			attribute.Float64("company.candidate.similarity", similarity),
			attribute.Bool("company.candidate.exact_key", exactKey),
			attribute.Bool("company.candidate.accepted", exactKey || similarity >= companySimilarityThreshold),
		}
		if !exactKey && similarity < companySimilarityThreshold {
			span.AddEvent("company.similarity_candidate", trace.WithAttributes(candidateAttrs...))
			continue
		}
		span.AddEvent("company.similarity_candidate", trace.WithAttributes(candidateAttrs...))
		matches = append(matches, companySimilarityMatch{
			ID:            trimRecord(asString(row["id"])),
			Name:          candidateName,
			Website:       asString(row["website"]),
			Similarity:    similarity,
			NormalizedKey: candidateKey,
			ExactKey:      exactKey,
		})
	}
	span.SetAttributes(attribute.Int("company.similarity_search.match_count", len(matches)))
	if len(matches) > 0 {
		span.SetAttributes(
			attribute.String("company.best_match.id", matches[0].ID),
			attribute.String("company.best_match.name", matches[0].Name),
			attribute.Float64("company.best_match.similarity", matches[0].Similarity),
			attribute.Bool("company.best_match.exact_key", matches[0].ExactKey),
		)
	}
	return matches, nil
}

func companySearchTerms(value string) []string {
	words := strings.FieldsFunc(strings.ToLower(value), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	filtered := words[:0]
	for _, word := range words {
		if isCompanyLegalSuffix(word) {
			continue
		}
		filtered = append(filtered, word)
	}
	return filtered
}

func companySearchKey(value string) string {
	return strings.Join(companySearchTerms(value), "")
}

func isCompanyLegalSuffix(word string) bool {
	switch word {
	case "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "ag":
		return true
	default:
		return false
	}
}

func (s *Server) getCompany(ctx context.Context, companyID string) (map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, `
SELECT
	id, user_id, name, website, job_board_identities, created_at, updated_at,
	count(SELECT VALUE id FROM applications WHERE company_id = $parent.id) AS application_count
FROM `+recordID("companies", companyID)+`;`)
	return firstRow(rows, err)
}

// findCompanyByJobBoardIdentity looks up the (at most one) company that has
// the given "<board>:<slug>" key in its job_board_identities array. Returns
// nil when no match is found. The schema's job_board_idx covers this query.
func (s *Server) findCompanyByJobBoardIdentity(ctx context.Context, identity string) (map[string]any, error) {
	identity = strings.TrimSpace(identity)
	if identity == "" {
		return nil, nil
	}
	rows, err := queryRows(ctx, s.app.DB, `
SELECT
	id, user_id, name, website, job_board_identities, created_at, updated_at,
	count(SELECT VALUE id FROM applications WHERE company_id = $parent.id) AS application_count
FROM companies WHERE job_board_identities CONTAINS `+surrealString(identity)+` LIMIT 1;`)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// appendCompanyJobBoardIdentity stores a "<board>:<slug>" identity on the
// company if it isn't already present. Used both when freshly creating a
// company from a parsed URL and when an existing company is reused — so the
// next posting on the same board for the same employer hits the cache.
// Read-then-write to keep the surreal query free of NONE-handling tricks;
// runs at most once per application create.
func (s *Server) appendCompanyJobBoardIdentity(ctx context.Context, companyID, identity string) error {
	identity = strings.TrimSpace(identity)
	if identity == "" || companyID == "" {
		return nil
	}
	existing, err := s.getCompany(ctx, companyID)
	if err != nil {
		return err
	}
	if existing == nil {
		return nil
	}
	current := jobBoardIdentitiesFromRow(existing)
	for _, id := range current {
		if id == identity {
			return nil
		}
	}
	current = append(current, identity)
	quoted := make([]string, len(current))
	for i, id := range current {
		quoted[i] = surrealString(id)
	}
	_, err = s.app.DB.Query(ctx, "UPDATE "+recordID("companies", companyID)+
		` SET job_board_identities = [`+strings.Join(quoted, ", ")+`], updated_at = time::now();`)
	return err
}

// jobBoardIdentitiesFromRow normalizes the surreal-returned shape of the
// job_board_identities field (typically []any with string entries, or nil
// when the field is NONE) into a flat []string.
func jobBoardIdentitiesFromRow(row map[string]any) []string {
	raw, ok := row["job_board_identities"]
	if !ok || raw == nil {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

func (s *Server) updateCompany(ctx context.Context, companyID string, name, website *string) (map[string]any, error) {
	sets := []string{"updated_at = time::now()"}
	if name != nil {
		sets = append(sets, "name = "+surrealString(*name))
	}
	if website != nil {
		sets = append(sets, "website = "+optionString(*website))
	}
	if _, err := s.app.DB.Query(ctx, "UPDATE "+recordID("companies", companyID)+" SET "+strings.Join(sets, ", ")+";"); err != nil {
		return nil, err
	}
	return s.getCompany(ctx, companyID)
}

type createApplicationInput struct {
	Name              string
	CompanyID         string
	JobDescriptionURL *string
	Status            string
	SharedWith        []string
}

func (s *Server) createApplication(ctx context.Context, in createApplicationInput) (map[string]any, error) {
	id := newID("application")
	sharedWith := in.SharedWith
	if sharedWith == nil {
		sharedWith = []string{}
	}
	sharedJSON, err := json.Marshal(sharedWith)
	if err != nil {
		return nil, err
	}
	status := in.Status
	if status == "" {
		status = "in_progress"
	}
	_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			user_id: users:local,
			company_id: %s,
			name: %s,
			job_description_url: %s,
			status: %s,
			visibility: "private",
			shared_with: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, recordID("applications", id), recordID("companies", in.CompanyID), surrealString(in.Name), optionStringPtr(in.JobDescriptionURL), surrealString(status), string(sharedJSON)))
	if err != nil {
		return nil, err
	}
	return s.getApplication(ctx, id)
}

func (s *Server) getApplication(ctx context.Context, applicationID string) (map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, `
SELECT
	id, user_id, true AS is_owner, company_id, company_id.name AS company_name, name, job_description_url, status, shared_with, created_at, updated_at,
	(SELECT id, application_id, parent_folder_id, name, created_at, updated_at FROM application_folders WHERE application_id = $parent.id ORDER BY created_at) AS folders,
	(SELECT
		id, user_id, application_id, folder_id, filename, file_type,
		current_version_id.storage_path AS storage_path,
		current_version_id.pdf_storage_path AS pdf_storage_path,
		size_bytes, page_count, structure_tree.root AS structure_tree, status, created_at, updated_at,
		current_version_id.version_number AS latest_version_number
	 FROM documents WHERE application_id = $parent.id ORDER BY updated_at DESC) AS documents,
	count(SELECT 1 FROM documents WHERE application_id = $parent.id) AS document_count,
	count(SELECT 1 FROM chats WHERE application_id = $parent.id) AS chat_count,
	count(SELECT 1 FROM tabular_reviews WHERE application_id = $parent.id) AS review_count
FROM `+recordID("applications", applicationID)+`;`)
	return firstRow(rows, err)
}

type updateApplicationInput struct {
	Name              *string
	CompanyID         *string
	JobDescriptionURL *string
	Status            *string
	SharedWith        []string
}

func (s *Server) updateApplication(ctx context.Context, applicationID string, in updateApplicationInput) (map[string]any, error) {
	sets := []string{"updated_at = time::now()"}
	if in.Name != nil {
		sets = append(sets, "name = "+surrealString(*in.Name))
	}
	if in.CompanyID != nil && *in.CompanyID != "" {
		sets = append(sets, "company_id = "+recordID("companies", *in.CompanyID))
	}
	if in.JobDescriptionURL != nil {
		sets = append(sets, "job_description_url = "+optionString(*in.JobDescriptionURL))
	}
	if in.Status != nil && *in.Status != "" {
		sets = append(sets, "status = "+surrealString(*in.Status))
	}
	sharedWith := in.SharedWith
	if sharedWith != nil {
		sharedJSON, err := json.Marshal(sharedWith)
		if err != nil {
			return nil, err
		}
		sets = append(sets, "shared_with = "+string(sharedJSON))
	}
	if _, err := s.app.DB.Query(ctx, "UPDATE "+recordID("applications", applicationID)+" SET "+strings.Join(sets, ", ")+";"); err != nil {
		return nil, err
	}
	return s.getApplication(ctx, applicationID)
}

func (s *Server) getDocument(ctx context.Context, documentID string) (map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, documentListQuery("id = "+recordID("documents", documentID)))
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) assignDocument(ctx context.Context, documentID, applicationID string, folderID *string) (map[string]any, error) {
	folderValue := "NONE"
	if folderID != nil && *folderID != "" {
		folderValue = recordID("application_folders", *folderID)
	}
	_, err := s.app.DB.Query(ctx, "UPDATE "+recordID("documents", documentID)+" SET application_id = "+recordID("applications", applicationID)+", folder_id = "+folderValue+", updated_at = time::now();")
	if err != nil {
		return nil, err
	}
	return s.getDocument(ctx, documentID)
}

func documentListQuery(where string) string {
	return `
SELECT
	id, user_id, application_id, folder_id, filename, file_type,
	current_version_id.storage_path AS storage_path,
	current_version_id.pdf_storage_path AS pdf_storage_path,
	size_bytes, page_count, structure_tree.root AS structure_tree, status, created_at, updated_at,
	current_version_id.version_number AS latest_version_number,
	library, library_kind, kind, interview_stage, topics, company_refs, people_refs,
	summary, dated_event_at, derived_from_id, metadata_status, metadata_processed_at, metadata_error,
	(SELECT VALUE application_id FROM document_application_links WHERE document_id = $parent.id) AS linked_application_ids
FROM documents WHERE ` + where + ` ORDER BY updated_at DESC;`
}

func (s *Server) upsertFolder(ctx context.Context, folderID, applicationID, name string, parentFolderID *string) (map[string]any, error) {
	if folderID == "" {
		folderID = newID("folder")
	}
	_, err := s.app.DB.Query(ctx, fmt.Sprintf(`
		UPSERT %s CONTENT {
			application_id: %s,
			user_id: users:local,
			name: %s,
			parent_folder_id: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, recordID("application_folders", folderID), recordID("applications", applicationID), surrealString(name), optionRecord("application_folders", parentFolderID)))
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, application_id, user_id, name, parent_folder_id, created_at, updated_at FROM "+recordID("application_folders", folderID)+";")
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) updateFolderRecord(ctx context.Context, folderID string, name *string, parentFolderID *string) (map[string]any, error) {
	sets := []string{"updated_at = time::now()"}
	if name != nil {
		sets = append(sets, "name = "+surrealString(*name))
	}
	if parentFolderID != nil {
		sets = append(sets, "parent_folder_id = "+optionRecord("application_folders", parentFolderID))
	}
	if _, err := s.app.DB.Query(ctx, "UPDATE "+recordID("application_folders", folderID)+" SET "+strings.Join(sets, ", ")+";"); err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, application_id, user_id, name, parent_folder_id, created_at, updated_at FROM "+recordID("application_folders", folderID)+";")
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) resolveDocumentVersion(ctx context.Context, documentID, versionID string) (documentVersionRef, error) {
	filename := ""
	if versionID == "" {
		docRows, err := queryRows(ctx, s.app.DB, "SELECT current_version_id, filename FROM "+recordID("documents", documentID)+";")
		if err != nil {
			return documentVersionRef{}, err
		}
		if len(docRows) == 0 {
			return documentVersionRef{}, fmt.Errorf("document not found")
		}
		versionID = trimRecord(asString(docRows[0]["current_version_id"]))
		filename = asString(docRows[0]["filename"])
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, storage_path, display_name FROM "+recordID("document_versions", versionID)+";")
	if err != nil {
		return documentVersionRef{}, err
	}
	if len(rows) == 0 {
		return documentVersionRef{}, fmt.Errorf("document version not found")
	}
	if displayName := asString(rows[0]["display_name"]); displayName != "" {
		filename = displayName
	}
	if filename == "" && documentID != "" {
		docRows, docErr := queryRows(ctx, s.app.DB, "SELECT filename FROM "+recordID("documents", documentID)+";")
		if docErr != nil {
			return documentVersionRef{}, docErr
		}
		if len(docRows) > 0 {
			filename = asString(docRows[0]["filename"])
		}
	}
	return documentVersionRef{ID: trimRecord(asString(rows[0]["id"])), StoragePath: asString(rows[0]["storage_path"]), Filename: filename}, nil
}

func (s *Server) nextVersionNumber(ctx context.Context, documentID string) (int, error) {
	rows, err := queryRows(ctx, s.app.DB, "SELECT math::max(version_number) AS max_version FROM document_versions WHERE document_id = "+recordID("documents", documentID)+";")
	if err != nil || len(rows) == 0 {
		return 2, err
	}
	return asInt(rows[0]["max_version"]) + 1, nil
}

func (s *Server) listDocumentVersions(ctx context.Context, documentID string) (map[string]any, error) {
	currentRows, err := queryRows(ctx, s.app.DB, "SELECT current_version_id FROM "+recordID("documents", documentID)+";")
	if err != nil {
		return nil, err
	}
	versionRows, err := queryRows(ctx, s.app.DB, "SELECT id, version_number, source, created_at, display_name FROM document_versions WHERE document_id = "+recordID("documents", documentID)+" ORDER BY version_number;")
	if err != nil {
		return nil, err
	}
	var current any
	if len(currentRows) > 0 {
		current = currentRows[0]["current_version_id"]
	}
	return map[string]any{"current_version_id": current, "versions": versionRows}, nil
}

func (s *Server) getDocumentVersion(ctx context.Context, versionID string) (map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, version_number, source, created_at, display_name FROM "+recordID("document_versions", versionID)+";")
	return firstRow(rows, err)
}

func (s *Server) resolveEdit(w http.ResponseWriter, r *http.Request, status string) {
	editID := r.PathValue("editId")
	edit, err := queryOne(r.Context(), s.app.DB, "SELECT id, document_id, version_id, change_id, del_w_id, ins_w_id, deleted_text, inserted_text, context_before, context_after, status FROM "+recordID("document_edits", editID)+";")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	documentID := trimRecord(asString(edit["document_id"]))
	sourceVersionID := trimRecord(asString(edit["version_id"]))
	sourceVersion, versionResolveErr := s.resolveDocumentVersion(r.Context(), documentID, sourceVersionID)
	if versionResolveErr != nil {
		writeError(w, http.StatusInternalServerError, versionResolveErr)
		return
	}
	data, readErr := localdata.ReadLocalFile(s.app.LocalStorageRoot, sourceVersion.StoragePath)
	if readErr != nil {
		writeError(w, http.StatusInternalServerError, readErr)
		return
	}
	accept := status == "accepted"
	resolvedBytes, changed, applyErr := applyTrackedChange(data, accept, asString(edit["change_id"]))
	if applyErr != nil {
		writeError(w, http.StatusInternalServerError, applyErr)
		return
	}
	if !changed {
		writeError(w, http.StatusUnprocessableEntity, fmt.Errorf("no tracked change found in document bytes"))
		return
	}
	versionNumber, versionErr := s.nextVersionNumber(r.Context(), documentID)
	if versionErr != nil {
		writeError(w, http.StatusInternalServerError, versionErr)
		return
	}
	versionID := documentID + "_resolved_" + strconv.Itoa(versionNumber)
	filename := sourceVersion.Filename
	if filename == "" {
		filename = documentID + ".docx"
	}
	nextStoragePath := documentID + "/" + versionID + "/" + filename
	if writeErr := localdata.WriteLocalFileAtomic(s.app.LocalStorageRoot, nextStoragePath, resolvedBytes); writeErr != nil {
		writeError(w, http.StatusInternalServerError, writeErr)
		return
	}
	source := "user_accept"
	if status == "rejected" {
		source = "user_reject"
	}
	_, err = s.app.DB.Query(r.Context(), fmt.Sprintf(`
			CREATE %s CONTENT {
				document_id: %s,
				storage_path: %s,
				pdf_storage_path: NONE,
				source: %s,
				version_number: %d,
				display_name: %s,
				created_at: time::now()
			};
			UPDATE %s SET current_version_id = %s, updated_at = time::now();
		`, recordID("document_versions", versionID), recordID("documents", documentID), surrealString(nextStoragePath), surrealString(source), versionNumber, surrealString(filename), recordID("documents", documentID), recordID("document_versions", versionID)))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if _, updateErr := s.app.DB.Query(r.Context(), "UPDATE "+recordID("document_edits", editID)+" SET status = "+surrealString(status)+", resolved_at = time::now();"); updateErr != nil {
		writeError(w, http.StatusInternalServerError, updateErr)
		return
	}
	rows, err := queryRows(r.Context(), s.app.DB, "SELECT id AS edit_id, document_id, version_id, change_id, del_w_id, ins_w_id, deleted_text, inserted_text, context_before, context_after, status FROM "+recordID("document_edits", editID)+";")
	writeFirst(w, rows, err)
}

func (s *Server) createChat(ctx context.Context, applicationID *string) (map[string]any, error) {
	id := newID("chat")
	_, err := s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			application_id: %s,
			user_id: users:local,
			title: "New Chat",
			created_at: time::now()
		};
	`, recordID("chats", id), optionRecord("applications", applicationID)))
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, chatListQuery("id = "+recordID("chats", id)))
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// seedAssistantGreeting persists a deterministic, non-streamed assistant
// greeting as the chat's first message. The content shape mirrors what the
// streaming pipeline writes — a single {type:"content", text} event — so the
// frontend's getChat decoder renders it the same way as any other assistant
// message. Used by the application-create flow to drop the user into a chat
// that already feels alive.
func (s *Server) seedAssistantGreeting(ctx context.Context, chatID, greeting string) error {
	greeting = strings.TrimSpace(greeting)
	if greeting == "" {
		return nil
	}
	messageID := newID("msg")
	timeline := []map[string]any{{"type": "content", "text": greeting}}
	return s.createChatMessageWithID(ctx, messageID, chatID, "assistant", timeline, nil, nil)
}

func chatListQuery(where string) string {
	return "SELECT id, application_id, user_id, title, created_at FROM chats WHERE " + where + " ORDER BY created_at DESC;"
}

func (s *Server) chatDetail(ctx context.Context, chatID string) (map[string]any, error) {
	chatRecordID := recordID("chats", chatID)
	ctx, span := startLocalSpan(ctx, "chat.detail",
		attribute.String("chat.id", chatID),
		attribute.String("chat.record_id", chatRecordID),
	)
	defer span.End()
	chats, err := queryRows(ctx, s.app.DB, chatListQuery("id = "+chatRecordID))
	if err != nil || len(chats) == 0 {
		recordSpanError(span, err)
		span.SetAttributes(attribute.Int("chat.detail.chat_count", len(chats)))
		return nil, err
	}
	messages, err := queryRows(ctx, s.app.DB, "SELECT id, chat_id, created_at, role, content, files, annotations FROM chat_messages WHERE chat_id = "+chatRecordID+" ORDER BY created_at;")
	if err != nil {
		recordSpanError(span, err)
		return nil, err
	}
	span.SetAttributes(
		attribute.Int("chat.detail.chat_count", len(chats)),
		attribute.Int("chat.detail.message_count", len(messages)),
	)
	return map[string]any{"chat": chats[0], "messages": messages}, nil
}

func (s *Server) createChatMessageWithID(ctx context.Context, messageID, chatID, role string, content any, files []chatRequestFile, annotations []map[string]any) error {
	chatRecordID := recordID("chats", chatID)
	_, span := startLocalSpan(ctx, "chat.persist_message",
		attribute.String("chat.id", chatID),
		attribute.String("chat.record_id", chatRecordID),
		attribute.String("chat.role", role),
		attribute.Int("chat.content_chars", contentCharLen(content)),
		attribute.Int("chat.file_count", len(files)),
		attribute.Int("chat.annotation_count", len(annotations)),
	)
	defer span.End()
	span.SetAttributes(attribute.String("chat.message_id", messageID))
	contentJSON, err := json.Marshal(content)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	annotationsJSON, err := json.Marshal(annotations)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	filePayload := make([]map[string]string, 0, len(files))
	for _, file := range files {
		if file.Filename == "" && file.DocumentID == "" {
			continue
		}
		filePayload = append(filePayload, map[string]string{
			"filename":    file.Filename,
			"document_id": file.DocumentID,
		})
	}
	filesJSON, err := json.Marshal(filePayload)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		UPSERT %s CONTENT {
			chat_id: %s,
			role: %s,
			content: %s,
			files: %s,
			annotations: %s,
			created_at: time::now()
		};
	`, recordID("chat_messages", messageID), chatRecordID, surrealString(role), string(contentJSON), string(filesJSON), string(annotationsJSON)))
	recordSpanError(span, err)
	return err
}

func (s *Server) updateChatMessageContent(ctx context.Context, messageID string, content any, annotations []map[string]any) error {
	_, span := startLocalSpan(ctx, "chat.update_message",
		attribute.String("chat.message_id", messageID),
		attribute.Int("chat.content_chars", contentCharLen(content)),
		attribute.Int("chat.annotation_count", len(annotations)),
	)
	defer span.End()
	if events, ok := content.([]map[string]any); ok {
		span.SetAttributes(
			attribute.Int("assistant.timeline_event_count", len(events)),
			attribute.String("assistant.timeline_last_event_type", lastTimelineEventType(events)),
		)
	}
	contentJSON, err := json.Marshal(content)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	annotationsJSON, err := json.Marshal(annotations)
	if err != nil {
		recordSpanError(span, err)
		return err
	}
	_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		UPDATE %s SET content = %s, annotations = %s;
	`, recordID("chat_messages", messageID), string(contentJSON), string(annotationsJSON)))
	recordSpanError(span, err)
	return err
}

func lastTimelineEventType(events []map[string]any) string {
	if len(events) == 0 {
		return ""
	}
	return asString(events[len(events)-1]["type"])
}

func contentCharLen(content any) int {
	switch value := content.(type) {
	case string:
		return len(value)
	case []map[string]any:
		data, _ := json.Marshal(value)
		return len(data)
	default:
		data, _ := json.Marshal(value)
		return len(data)
	}
}

func (s *Server) insertTabularChatMessage(ctx context.Context, chatID, role, content string) error {
	_, span := startLocalSpan(ctx, "tabular_chat.persist_message",
		attribute.String("chat.id", chatID),
		attribute.String("chat.role", role),
		attribute.Int("chat.content_chars", len(content)),
	)
	defer span.End()
	if strings.TrimSpace(content) == "" {
		span.SetAttributes(attribute.Bool("chat.persist_skipped", true))
		return nil
	}
	id := newID("tabchatmsg")
	span.SetAttributes(attribute.String("chat.message_id", id))
	_, err := s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			chat_id: %s,
			role: %s,
			content: %s,
			annotations: [],
			created_at: time::now()
		};
	`, recordID("tabular_review_chat_messages", id), recordID("tabular_review_chats", chatID), surrealString(role), surrealString(content)))
	recordSpanError(span, err)
	return err
}

func (s *Server) upsertWorkflow(ctx context.Context, workflowID string, req workflowPayload) (map[string]any, error) {
	isNew := workflowID == ""
	if workflowID == "" {
		workflowID = newID("workflow")
	}
	if req.Title == "" {
		req.Title = "Untitled Workflow"
	}
	if req.Type == "" {
		req.Type = "tabular"
	}
	columnsJSON, err := json.Marshal(req.ColumnsConfig)
	if err != nil {
		return nil, err
	}
	anchorJSON := "NONE"
	if req.AnchorExtractor != nil {
		b, marshalErr := json.Marshal(req.AnchorExtractor)
		if marshalErr != nil {
			return nil, marshalErr
		}
		anchorJSON = string(b)
	}
	query := fmt.Sprintf(`
		CREATE %s CONTENT {
			user_id: users:local,
			title: %s,
			type: %s,
			prompt_md: %s,
			columns_config: %s,
			practice: %s,
			row_mode: %s,
			anchor_extractor: %s,
			is_system: false,
			created_at: time::now()
		};
	`, recordID("workflows", workflowID), surrealString(req.Title), surrealString(req.Type), optionStringPtr(req.PromptMd), string(columnsJSON), optionStringPtr(req.Practice), optionStringPtr(req.RowMode), anchorJSON)
	if !isNew {
		query = fmt.Sprintf(`
		UPDATE %s SET
			user_id = users:local,
			title = %s,
			type = %s,
			prompt_md = %s,
			columns_config = %s,
			practice = %s,
			row_mode = %s,
			anchor_extractor = %s,
			is_system = false;
	`, recordID("workflows", workflowID), surrealString(req.Title), surrealString(req.Type), optionStringPtr(req.PromptMd), string(columnsJSON), optionStringPtr(req.Practice), optionStringPtr(req.RowMode), anchorJSON)
	}
	_, err = s.app.DB.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, user_id, title, type, prompt_md, columns_config, is_system, created_at, practice, row_mode, anchor_extractor, true AS is_owner FROM "+recordID("workflows", workflowID)+";")
	if len(rows) == 0 && !isNew {
		_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		UPSERT %s CONTENT {
			user_id: users:local,
			title: %s,
			type: %s,
			prompt_md: %s,
			columns_config: %s,
			practice: %s,
			row_mode: %s,
			anchor_extractor: %s,
			is_system: false,
			created_at: time::now()
		};
	`, recordID("workflows", workflowID), surrealString(req.Title), surrealString(req.Type), optionStringPtr(req.PromptMd), string(columnsJSON), optionStringPtr(req.Practice), optionStringPtr(req.RowMode), anchorJSON))
		if err != nil {
			return nil, err
		}
		rows, err = queryRows(ctx, s.app.DB, "SELECT id, user_id, title, type, prompt_md, columns_config, is_system, created_at, practice, row_mode, anchor_extractor, true AS is_owner FROM "+recordID("workflows", workflowID)+";")
	}
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) upsertTabularReview(ctx context.Context, reviewID string, req tabularPayload) (map[string]any, error) {
	creating := reviewID == ""
	if creating {
		reviewID = newID("review")
	}
	recID := recordID("tabular_reviews", reviewID)

	// Build a partial MERGE payload so PATCH preserves fields the caller did
	// not specify. Only fields the request explicitly carries are touched.
	merge := map[string]string{
		"updated_at": "time::now()",
	}
	if req.Title != nil {
		title := *req.Title
		if title == "" {
			title = "Untitled Review"
		}
		merge["title"] = surrealString(title)
	} else if creating {
		merge["title"] = surrealString("Untitled Review")
	}
	if req.ColumnsConfig != nil {
		columnsJSON, err := json.Marshal(req.ColumnsConfig)
		if err != nil {
			return nil, err
		}
		merge["columns_config"] = string(columnsJSON)
	}
	if req.ApplicationID != nil {
		merge["application_id"] = optionRecord("applications", req.ApplicationID)
	}
	if req.WorkflowID != nil {
		merge["workflow_id"] = optionRecord("workflows", req.WorkflowID)
	}
	if req.SharedWith != nil {
		sharedJSON, err := json.Marshal(req.SharedWith)
		if err != nil {
			return nil, err
		}
		merge["shared_with"] = string(sharedJSON)
	}
	if req.RowMode != nil {
		merge["row_mode"] = surrealString(*req.RowMode)
	}
	if req.AnchorExtractor != nil {
		anchorJSON, err := json.Marshal(req.AnchorExtractor)
		if err != nil {
			return nil, err
		}
		merge["anchor_extractor"] = string(anchorJSON)
	}
	if creating {
		merge["user_id"] = "users:local"
		merge["created_at"] = "time::now()"
		if _, hasTitle := merge["title"]; !hasTitle {
			merge["title"] = surrealString("Untitled Review")
		}
		// Schema requires shared_with to be an array; ensure it defaults on
		// fresh creates even when the caller omitted the field.
		if _, has := merge["shared_with"]; !has {
			merge["shared_with"] = "[]"
		}
	}

	var b strings.Builder
	b.WriteString("UPSERT ")
	b.WriteString(recID)
	b.WriteString(" MERGE {")
	first := true
	for k, v := range merge {
		if !first {
			b.WriteString(",")
		}
		first = false
		b.WriteString("\n\t")
		b.WriteString(k)
		b.WriteString(": ")
		b.WriteString(v)
	}
	b.WriteString("\n};")
	if _, err := s.app.DB.Query(ctx, b.String()); err != nil {
		return nil, err
	}

	// Resolve effective row_mode (request → persisted) for cell seeding.
	effectiveRowMode := ""
	if req.RowMode != nil {
		effectiveRowMode = *req.RowMode
	} else {
		rows, err := queryRows(ctx, s.app.DB, "SELECT row_mode FROM "+recID+";")
		if err == nil && len(rows) > 0 {
			effectiveRowMode = asString(rows[0]["row_mode"])
		}
	}

	// Seed pending tabular_cells only in document-row mode. Entity-row reviews
	// create cells lazily, one row at a time, after anchor extraction.
	if effectiveRowMode != "entity" {
		for _, docID := range req.DocumentIDs {
			for index := range req.ColumnsConfig {
				if _, cellErr := s.upsertCell(ctx, reviewID, docID, index, "pending"); cellErr != nil {
					return nil, cellErr
				}
			}
		}
	}

	rows, err := queryRows(ctx, s.app.DB, "SELECT id, application_id, user_id, title, columns_config, workflow_id, practice, shared_with, row_mode, anchor_extractor, true AS is_owner, created_at, updated_at, 0 AS document_count FROM "+recID+";")
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) tabularDetail(ctx context.Context, reviewID string) (map[string]any, error) {
	recID := recordID("tabular_reviews", reviewID)
	reviews, err := queryRows(ctx, s.app.DB, "SELECT id, application_id, user_id, title, columns_config, workflow_id, practice, shared_with, row_mode, anchor_extractor, true AS is_owner, created_at, updated_at FROM "+recID+";")
	if err != nil || len(reviews) == 0 {
		return nil, err
	}
	rowMode := asString(reviews[0]["row_mode"])

	// Document-row payload — cells keyed by (document, column).
	cells, err := queryRows(ctx, s.app.DB, "SELECT id, review_id, document_id, column_index, content, status, created_at FROM tabular_cells WHERE review_id = "+recID+" ORDER BY document_id, column_index;")
	if err != nil {
		return nil, err
	}

	// Entity-row payload — rows + row_cells keyed by (row, column). Empty
	// arrays in document-row reviews; clients ignore them.
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, review_id, document_id, row_index, anchor, created_at FROM tabular_review_rows WHERE review_id = "+recID+" ORDER BY row_index;")
	if err != nil {
		return nil, err
	}
	rowCells, err := queryRows(ctx, s.app.DB, "SELECT id, row_id, column_index, content, status, created_at FROM tabular_row_cells WHERE row_id IN (SELECT VALUE id FROM tabular_review_rows WHERE review_id = "+recID+") ORDER BY row_id, column_index;")
	if err != nil {
		return nil, err
	}

	// Document list: in document-row mode use the docs referenced by cells; in
	// entity-row mode use the source documents referenced by rows. Both sets
	// surface a uniform "documents" array to the frontend.
	var docsWhere string
	if rowMode == "entity" {
		docsWhere = "id IN (SELECT VALUE document_id FROM tabular_review_rows WHERE review_id = " + recID + ")"
	} else {
		docsWhere = "id IN (SELECT VALUE document_id FROM tabular_cells WHERE review_id = " + recID + ")"
	}
	docs, err := queryRows(ctx, s.app.DB, documentListQuery(docsWhere))
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"review":    reviews[0],
		"cells":     cells,
		"rows":      rows,
		"row_cells": rowCells,
		"documents": docs,
	}, nil
}

func (s *Server) upsertCell(ctx context.Context, reviewID, documentID string, columnIndex int, status string) (map[string]any, error) {
	return s.upsertCellWithContent(ctx, reviewID, documentID, columnIndex, "Local mock answer", status)
}

func (s *Server) upsertCellWithContent(ctx context.Context, reviewID, documentID string, columnIndex int, content string, status string) (map[string]any, error) {
	// Look up the existing cell by the natural key (review_id, document_id,
	// column_index) — the unique index guarantees at most one match. If found,
	// UPDATE in place to preserve the original record ID (which may pre-date
	// the current ID scheme); otherwise CREATE a fresh cell with the canonical
	// composite ID. This avoids UPSERT-with-a-specific-ID hitting the index
	// when an older record satisfies the same natural key under a different
	// primary key.
	existingRows, err := queryRows(ctx, s.app.DB, fmt.Sprintf(
		"SELECT id FROM tabular_cells WHERE review_id = %s AND document_id = %s AND column_index = %d LIMIT 1;",
		recordID("tabular_reviews", reviewID), recordID("documents", documentID), columnIndex,
	))
	if err != nil {
		return nil, err
	}

	var cellRecordRef string
	if len(existingRows) > 0 {
		if rawID, ok := existingRows[0]["id"].(string); ok && rawID != "" {
			cellRecordRef = rawID
		}
	}
	if cellRecordRef == "" {
		cellRecordRef = recordID("tabular_cells", reviewID+"_"+documentID+"_"+strconv.Itoa(columnIndex))
	}

	if len(existingRows) > 0 {
		_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
			UPDATE %s SET
				review_id = %s,
				document_id = %s,
				column_index = %d,
				content = { summary: %s },
				citations = {},
				status = %s;
		`, cellRecordRef, recordID("tabular_reviews", reviewID), recordID("documents", documentID), columnIndex, surrealString(content), surrealString(status)))
	} else {
		_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
			CREATE %s CONTENT {
				review_id: %s,
				document_id: %s,
				column_index: %d,
				content: { summary: %s },
				citations: {},
				status: %s,
				created_at: time::now()
			};
		`, cellRecordRef, recordID("tabular_reviews", reviewID), recordID("documents", documentID), columnIndex, surrealString(content), surrealString(status)))
	}
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, review_id, document_id, column_index, content, status, created_at FROM "+cellRecordRef+";")
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) createTabularChat(ctx context.Context, reviewID string) (map[string]any, error) {
	id := newID("tabchat")
	_, err := s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			review_id: %s,
			user_id: users:local,
			title: "New Chat",
			created_at: time::now(),
			updated_at: time::now()
		};
	`, recordID("tabular_review_chats", id), recordID("tabular_reviews", reviewID)))
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, review_id AS application_id, user_id, title, created_at FROM "+recordID("tabular_review_chats", id)+";")
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) peopleResponse() map[string]any {
	return map[string]any{
		"owner": map[string]any{
			"user_id":      "local-user",
			"email":        "local@luke.local",
			"display_name": "Local User",
		},
		"members": []any{},
	}
}

func recordID(table, rawID string) string {
	return localdata.RecordID(table, rawID)
}

func trimRecord(value string) string {
	if decoded, err := url.PathUnescape(value); err == nil {
		value = decoded
	}
	if strings.Contains(value, ":") {
		return strings.SplitN(value, ":", 2)[1]
	}
	return value
}

func surrealString(value string) string {
	return strconv.Quote(value)
}

func optionString(value string) string {
	if value == "" {
		return "NONE"
	}
	return surrealString(value)
}

func optionStringPtr(value *string) string {
	if value == nil {
		return "NONE"
	}
	return optionString(*value)
}

func optionRecord(table string, value *string) string {
	if value == nil || *value == "" {
		return "NONE"
	}
	return recordID(table, *value)
}

func newID(prefix string) string {
	var suffix [4]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return prefix + "_" + strconv.FormatInt(time.Now().UTC().UnixNano(), 36)
	}
	return prefix + "_" + strconv.FormatInt(time.Now().UTC().UnixNano(), 36) + "_" + hex.EncodeToString(suffix[:])
}

func encodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func asString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	default:
		return ""
	}
}

func asInt(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	default:
		return 0
	}
}

func asFloat64(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		n, _ := v.Float64()
		return n
	default:
		return 0
	}
}

func queryOne(ctx context.Context, db *persistence.DB, query string) (map[string]any, error) {
	rows, err := queryRows(ctx, db, query)
	return firstRow(rows, err)
}

func firstRow(rows []map[string]any, err error) (map[string]any, error) {
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}
