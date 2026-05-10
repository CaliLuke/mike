package localapi

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
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
	Title         string           `json:"title"`
	Type          string           `json:"type"`
	PromptMd      *string          `json:"prompt_md"`
	ColumnsConfig []map[string]any `json:"columns_config"`
	Practice      *string          `json:"practice"`
}

type tabularPayload struct {
	Title         *string          `json:"title"`
	DocumentIDs   []string         `json:"document_ids"`
	ColumnsConfig []map[string]any `json:"columns_config"`
	WorkflowID    *string          `json:"workflow_id"`
	ApplicationID *string          `json:"application_id"`
	SharedWith    []string         `json:"shared_with"`
}

var nonRecordID = regexp.MustCompile(`[^A-Za-z0-9_]+`)

const applicationListQuery = `
SELECT
	id, user_id, true AS is_owner, company_id, company_id.name AS company_name, name, cm_number, shared_with, created_at, updated_at,
	[] AS folders, 0 AS document_count, 0 AS chat_count, 0 AS review_count
FROM applications ORDER BY updated_at DESC;`

const companyListQuery = `
SELECT
	id, user_id, name, website, created_at, updated_at,
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
	id := newID("company")
	_, err := s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			user_id: users:local,
			name: %s,
			website: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, recordID("companies", id), surrealString(name), optionStringPtr(website)))
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
	id, user_id, name, website, created_at, updated_at,
	count(SELECT VALUE id FROM applications WHERE company_id = $parent.id) AS application_count
FROM `+recordID("companies", companyID)+`;`)
	return firstRow(rows, err)
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

func (s *Server) createApplication(ctx context.Context, name, companyID string, cmNumber *string, sharedWith []string) (map[string]any, error) {
	id := newID("application")
	if sharedWith == nil {
		sharedWith = []string{}
	}
	sharedJSON, err := json.Marshal(sharedWith)
	if err != nil {
		return nil, err
	}
	_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			user_id: users:local,
			company_id: %s,
			name: %s,
			cm_number: %s,
			visibility: "private",
			shared_with: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, recordID("applications", id), recordID("companies", companyID), surrealString(name), optionStringPtr(cmNumber), string(sharedJSON)))
	if err != nil {
		return nil, err
	}
	return s.getApplication(ctx, id)
}

func (s *Server) getApplication(ctx context.Context, applicationID string) (map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, `
SELECT
	id, user_id, true AS is_owner, company_id, company_id.name AS company_name, name, cm_number, shared_with, created_at, updated_at,
	[] AS folders, 0 AS document_count, 0 AS chat_count, 0 AS review_count
FROM `+recordID("applications", applicationID)+`;`)
	return firstRow(rows, err)
}

func (s *Server) updateApplication(ctx context.Context, applicationID string, name, companyID, cmNumber *string, sharedWith []string) (map[string]any, error) {
	sets := []string{"updated_at = time::now()"}
	if name != nil {
		sets = append(sets, "name = "+surrealString(*name))
	}
	if companyID != nil && *companyID != "" {
		sets = append(sets, "company_id = "+recordID("companies", *companyID))
	}
	if cmNumber != nil {
		sets = append(sets, "cm_number = "+optionString(*cmNumber))
	}
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
	current_version_id.version_number AS latest_version_number
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

func chatListQuery(where string) string {
	return "SELECT id, application_id, user_id, title, created_at FROM chats WHERE " + where + " ORDER BY created_at DESC;"
}

func (s *Server) chatDetail(ctx context.Context, chatID string) (map[string]any, error) {
	chats, err := queryRows(ctx, s.app.DB, chatListQuery("id = "+recordID("chats", chatID)))
	if err != nil || len(chats) == 0 {
		return nil, err
	}
	messages, err := queryRows(ctx, s.app.DB, "SELECT id, chat_id, created_at, role, content, files, annotations FROM chat_messages WHERE chat_id = "+recordID("chats", chatID)+" ORDER BY created_at;")
	if err != nil {
		return nil, err
	}
	return map[string]any{"chat": chats[0], "messages": messages}, nil
}

func (s *Server) insertChatMessage(ctx context.Context, chatID, role, content string, annotations []map[string]any) error {
	return s.insertChatMessageWithFiles(ctx, chatID, role, content, nil, annotations)
}

func (s *Server) insertChatMessageWithFiles(ctx context.Context, chatID, role, content string, files []chatRequestFile, annotations []map[string]any) error {
	_, span := startLocalSpan(ctx, "chat.persist_message",
		attribute.String("chat.id", chatID),
		attribute.String("chat.role", role),
		attribute.Int("chat.content_chars", len(content)),
		attribute.Int("chat.file_count", len(files)),
		attribute.Int("chat.annotation_count", len(annotations)),
	)
	defer span.End()
	if strings.TrimSpace(content) == "" {
		span.SetAttributes(attribute.Bool("chat.persist_skipped", true))
		return nil
	}
	id := newID("chatmsg")
	span.SetAttributes(attribute.String("chat.message_id", id))
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
		CREATE %s CONTENT {
			chat_id: %s,
			role: %s,
			content: %s,
			files: %s,
			annotations: %s,
			created_at: time::now()
		};
	`, recordID("chat_messages", id), recordID("chats", chatID), surrealString(role), surrealString(content), string(filesJSON), string(annotationsJSON)))
	recordSpanError(span, err)
	return err
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
	query := fmt.Sprintf(`
		CREATE %s CONTENT {
			user_id: users:local,
			title: %s,
			type: %s,
			prompt_md: %s,
			columns_config: %s,
			practice: %s,
			is_system: false,
			created_at: time::now()
		};
	`, recordID("workflows", workflowID), surrealString(req.Title), surrealString(req.Type), optionStringPtr(req.PromptMd), string(columnsJSON), optionStringPtr(req.Practice))
	if !isNew {
		query = fmt.Sprintf(`
		UPDATE %s SET
			user_id = users:local,
			title = %s,
			type = %s,
			prompt_md = %s,
			columns_config = %s,
			practice = %s,
			is_system = false;
	`, recordID("workflows", workflowID), surrealString(req.Title), surrealString(req.Type), optionStringPtr(req.PromptMd), string(columnsJSON), optionStringPtr(req.Practice))
	}
	_, err = s.app.DB.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, user_id, title, type, prompt_md, columns_config, is_system, created_at, practice, true AS is_owner FROM "+recordID("workflows", workflowID)+";")
	if len(rows) == 0 && !isNew {
		_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		UPSERT %s CONTENT {
			user_id: users:local,
			title: %s,
			type: %s,
			prompt_md: %s,
			columns_config: %s,
			practice: %s,
			is_system: false,
			created_at: time::now()
		};
	`, recordID("workflows", workflowID), surrealString(req.Title), surrealString(req.Type), optionStringPtr(req.PromptMd), string(columnsJSON), optionStringPtr(req.Practice)))
		if err != nil {
			return nil, err
		}
		rows, err = queryRows(ctx, s.app.DB, "SELECT id, user_id, title, type, prompt_md, columns_config, is_system, created_at, practice, true AS is_owner FROM "+recordID("workflows", workflowID)+";")
	}
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) upsertTabularReview(ctx context.Context, reviewID string, req tabularPayload) (map[string]any, error) {
	if reviewID == "" {
		reviewID = newID("review")
	}
	title := "Untitled Review"
	if req.Title != nil && *req.Title != "" {
		title = *req.Title
	}
	columnsJSON, err := json.Marshal(req.ColumnsConfig)
	if err != nil {
		return nil, err
	}
	if req.SharedWith == nil {
		req.SharedWith = []string{}
	}
	sharedJSON, err := json.Marshal(req.SharedWith)
	if err != nil {
		return nil, err
	}
	_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		UPSERT %s CONTENT {
			application_id: %s,
			user_id: users:local,
			title: %s,
			columns_config: %s,
			workflow_id: %s,
			practice: NONE,
			shared_with: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, recordID("tabular_reviews", reviewID), optionRecord("applications", req.ApplicationID), surrealString(title), string(columnsJSON), optionRecord("workflows", req.WorkflowID), string(sharedJSON)))
	if err != nil {
		return nil, err
	}
	for _, docID := range req.DocumentIDs {
		for index := range req.ColumnsConfig {
			if _, cellErr := s.upsertCell(ctx, reviewID, docID, index, "pending"); cellErr != nil {
				return nil, cellErr
			}
		}
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, application_id, user_id, title, columns_config, workflow_id, practice, shared_with, true AS is_owner, created_at, updated_at, 0 AS document_count FROM "+recordID("tabular_reviews", reviewID)+";")
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func (s *Server) tabularDetail(ctx context.Context, reviewID string) (map[string]any, error) {
	reviews, err := queryRows(ctx, s.app.DB, "SELECT id, application_id, user_id, title, columns_config, workflow_id, practice, shared_with, true AS is_owner, created_at, updated_at FROM "+recordID("tabular_reviews", reviewID)+";")
	if err != nil || len(reviews) == 0 {
		return nil, err
	}
	cells, err := queryRows(ctx, s.app.DB, "SELECT id, review_id, document_id, column_index, content, status, created_at FROM tabular_cells WHERE review_id = "+recordID("tabular_reviews", reviewID)+" ORDER BY document_id, column_index;")
	if err != nil {
		return nil, err
	}
	docs, err := queryRows(ctx, s.app.DB, documentListQuery("id IN (SELECT VALUE document_id FROM tabular_cells WHERE review_id = "+recordID("tabular_reviews", reviewID)+")"))
	if err != nil {
		return nil, err
	}
	return map[string]any{"review": reviews[0], "cells": cells, "documents": docs}, nil
}

func (s *Server) upsertCell(ctx context.Context, reviewID, documentID string, columnIndex int, status string) (map[string]any, error) {
	return s.upsertCellWithContent(ctx, reviewID, documentID, columnIndex, "Local mock answer", status)
}

func (s *Server) upsertCellWithContent(ctx context.Context, reviewID, documentID string, columnIndex int, content string, status string) (map[string]any, error) {
	id := reviewID + "_" + documentID + "_" + strconv.Itoa(columnIndex)
	_, err := s.app.DB.Query(ctx, fmt.Sprintf(`
		UPSERT %s CONTENT {
			review_id: %s,
			document_id: %s,
			column_index: %d,
			content: %s,
			citations: {},
			status: %s,
			created_at: time::now()
		};
	`, recordID("tabular_cells", id), recordID("tabular_reviews", reviewID), recordID("documents", documentID), columnIndex, surrealString(content), surrealString(status)))
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, review_id, document_id, column_index, content, status, created_at FROM "+recordID("tabular_cells", id)+";")
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
	if strings.Contains(rawID, ":") {
		parts := strings.SplitN(rawID, ":", 2)
		rawID = parts[1]
	}
	return table + ":" + nonRecordID.ReplaceAllString(rawID, "_")
}

func trimRecord(value string) string {
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
