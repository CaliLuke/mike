package localapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/i2y/romancy"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/CaliLuke/luke/backend-go/internal/localapi/chatv2"
	"github.com/CaliLuke/luke/backend-go/internal/localdata"
	"github.com/CaliLuke/luke/backend-go/internal/persistence"
	"github.com/CaliLuke/luke/backend-go/internal/telemetry"
)

const defaultListenAddr = "127.0.0.1:3001"

type Server struct {
	app             *localdata.App
	tel             *telemetry.Telemetry
	chatRunWorkflow *romancy.WorkflowFunc[chatExecutionInput, chatExecutionResult]
	chatV2Registry  *chatv2.Registry
	chatV2Service   *chatv2.Service
}

func New(app *localdata.App, tel *telemetry.Telemetry) http.Handler {
	server := &Server{app: app, tel: tel, chatV2Registry: chatv2.NewRegistry()}
	server.registerChatExecutionWorkflow()
	server.chatV2Service = chatv2.NewService(server.chatV2Registry, server.chatV2Deps())
	server.chatV2Service.RegisterRomancy(app.Romancy)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("POST /user/profile", server.profile)
	mux.HandleFunc("GET /user/profile", server.profile)
	mux.HandleFunc("POST /users/profile", server.profile)
	mux.HandleFunc("GET /users/profile", server.profile)
	mux.HandleFunc("DELETE /user", server.deleteAccount)
	mux.HandleFunc("DELETE /user/account", server.deleteAccount)
	mux.HandleFunc("DELETE /users", server.deleteAccount)
	mux.HandleFunc("DELETE /users/account", server.deleteAccount)
	mux.HandleFunc("GET /companies", server.companies)
	mux.HandleFunc("POST /companies", server.companies)
	mux.HandleFunc("GET /companies/{companyId}", server.company)
	mux.HandleFunc("PATCH /companies/{companyId}", server.company)
	mux.HandleFunc("DELETE /companies/{companyId}", server.company)
	mux.HandleFunc("GET /applications", server.applications)
	mux.HandleFunc("POST /applications", server.applications)
	mux.HandleFunc("GET /applications/{applicationId}", server.application)
	mux.HandleFunc("PATCH /applications/{applicationId}", server.application)
	mux.HandleFunc("DELETE /applications/{applicationId}", server.application)
	mux.HandleFunc("GET /applications/{applicationId}/documents", server.applicationDocuments)
	mux.HandleFunc("POST /applications/{applicationId}/documents", server.uploadApplicationDocument)
	mux.HandleFunc("POST /applications/{applicationId}/documents/{documentId}", server.attachApplicationDocument)
	mux.HandleFunc("POST /applications/{applicationId}/upload", server.uploadApplicationDocument)
	mux.HandleFunc("GET /applications/{applicationId}/people", server.applicationPeople)
	mux.HandleFunc("GET /applications/{applicationId}/chats", server.applicationChats)
	mux.HandleFunc("POST /applications/{applicationId}/chat", server.applicationChatStream)
	mux.HandleFunc("POST /applications/{applicationId}/folders", server.createFolder)
	mux.HandleFunc("PATCH /applications/{applicationId}/folders/{folderId}", server.updateFolder)
	mux.HandleFunc("DELETE /applications/{applicationId}/folders/{folderId}", server.deleteFolder)
	mux.HandleFunc("PATCH /applications/{applicationId}/documents/{documentId}/folder", server.moveDocument)
	mux.HandleFunc("GET /single-documents", server.documents)
	mux.HandleFunc("POST /single-documents", server.documents)
	mux.HandleFunc("DELETE /single-documents/{documentId}", server.document)
	mux.HandleFunc("GET /single-documents/{documentId}/display", server.displayDocument)
	mux.HandleFunc("GET /single-documents/{documentId}/url", server.documentURL)
	mux.HandleFunc("GET /single-documents/{documentId}/docx", server.docxDocument)
	mux.HandleFunc("POST /single-documents/zip", server.zipDocuments)
	mux.HandleFunc("POST /single-documents/download-zip", server.zipDocuments)
	mux.HandleFunc("GET /single-documents/{documentId}/versions", server.documentVersions)
	mux.HandleFunc("POST /single-documents/{documentId}/versions", server.uploadDocumentVersion)
	mux.HandleFunc("PATCH /single-documents/{documentId}/versions/{versionId}", server.renameDocumentVersion)
	mux.HandleFunc("GET /single-documents/{documentId}/tracked-change-ids", server.trackedChangeIDs)
	mux.HandleFunc("POST /single-documents/{documentId}/edits/{editId}/accept", server.acceptEdit)
	mux.HandleFunc("POST /single-documents/{documentId}/edits/{editId}/reject", server.rejectEdit)
	mux.HandleFunc("POST /single-documents/{documentId}/process-metadata", server.processSingleDocumentMetadata)
	mux.HandleFunc("POST /single-documents/process-metadata", server.processDocumentMetadataBatch)
	mux.HandleFunc("GET /single-documents/metadata-queue", server.metadataQueueStats)
	mux.HandleFunc("PATCH /single-documents/{documentId}/metadata", server.patchDocumentMetadata)
	mux.HandleFunc("POST /single-documents/{documentId}/application-links", server.addDocumentApplicationLink)
	mux.HandleFunc("DELETE /single-documents/{documentId}/application-links/{applicationId}", server.deleteDocumentApplicationLink)
	mux.HandleFunc("POST /single-documents/{documentId}/reextract-text", server.reextractSingleDocumentText)
	mux.HandleFunc("POST /single-documents/reextract-text", server.reextractDocumentTextBatch)
	mux.HandleFunc("GET /chats", server.chats)
	mux.HandleFunc("POST /chats", server.chats)
	mux.HandleFunc("GET /chats/{chatId}", server.chat)
	mux.HandleFunc("PATCH /chats/{chatId}", server.chat)
	mux.HandleFunc("DELETE /chats/{chatId}", server.chat)
	mux.HandleFunc("GET /chat", server.chats)
	mux.HandleFunc("POST /chat/create", server.chats)
	mux.HandleFunc("GET /chat/{chatId}", server.chat)
	mux.HandleFunc("PATCH /chat/{chatId}", server.chat)
	mux.HandleFunc("DELETE /chat/{chatId}", server.chat)
	mux.HandleFunc("POST /chat", server.globalChatStream)
	mux.HandleFunc("POST /chat/{chatId}/generate-title", server.generateChatTitle)
	mux.HandleFunc("GET /workflows", server.workflows)
	mux.HandleFunc("POST /workflows", server.workflows)
	mux.HandleFunc("GET /workflows/hidden", server.hiddenWorkflows)
	mux.HandleFunc("POST /workflows/hidden", server.hideWorkflow)
	mux.HandleFunc("DELETE /workflows/hidden/{workflowId}", server.unhideWorkflow)
	mux.HandleFunc("GET /workflows/{workflowId}", server.workflow)
	mux.HandleFunc("PUT /workflows/{workflowId}", server.workflow)
	mux.HandleFunc("PATCH /workflows/{workflowId}", server.workflow)
	mux.HandleFunc("DELETE /workflows/{workflowId}", server.workflow)
	mux.HandleFunc("GET /workflows/{workflowId}/shares", server.workflowShares)
	mux.HandleFunc("POST /workflows/{workflowId}/share", server.shareWorkflow)
	mux.HandleFunc("DELETE /workflows/{workflowId}/shares/{shareId}", server.deleteWorkflowShare)
	mux.HandleFunc("GET /tabular-review", server.tabularReviews)
	mux.HandleFunc("POST /tabular-review", server.tabularReviews)
	mux.HandleFunc("POST /tabular-review/prompt", server.tabularPrompt)
	mux.HandleFunc("GET /tabular-review/{reviewId}", server.tabularReview)
	mux.HandleFunc("PATCH /tabular-review/{reviewId}", server.tabularReview)
	mux.HandleFunc("DELETE /tabular-review/{reviewId}", server.tabularReview)
	mux.HandleFunc("POST /tabular-review/{reviewId}/generate", server.tabularGenerate)
	mux.HandleFunc("POST /tabular-review/{reviewId}/regenerate-cell", server.regenerateCell)
	mux.HandleFunc("POST /tabular-review/{reviewId}/clear-cells", server.clearCells)
	mux.HandleFunc("GET /tabular-review/{reviewId}/chats", server.tabularChats)
	mux.HandleFunc("DELETE /tabular-review/{reviewId}/chats/{chatId}", server.deleteTabularChat)
	mux.HandleFunc("GET /tabular-review/{reviewId}/chats/{chatId}/messages", server.tabularChatMessages)
	mux.HandleFunc("POST /tabular-review/{reviewId}/chat", server.tabularChatStream)
	mux.HandleFunc("GET /download/{token}", server.downloadToken)
	if server.tel != nil {
		mux.Handle("POST /v1/traces", server.tel.SpanIngestHandler())
		mux.Handle("DELETE /v1/traces", server.tel.WipeHandler())
	}
	mux.HandleFunc("POST /diagnostics/reset-content", server.resetUserContent)
	return localdata.LocalCORSMiddleware(localdata.LocalUserMiddleware(mux))
}

func ListenAddr(configured string) string {
	if configured != "" {
		return configured
	}
	return defaultListenAddr
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	body := map[string]any{}
	if r.Method == http.MethodPost {
		if err := decodeJSON(r, &body); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := s.updateProfile(r.Context(), body); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	profile, err := s.loadProfile(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Server) deleteAccount(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) resetUserContent(w http.ResponseWriter, r *http.Request) {
	if err := s.app.ResetUserContent(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) companies(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := queryRows(r.Context(), s.app.DB, companyListQuery)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	case http.MethodPost:
		var req struct {
			Name    string  `json:"name"`
			Website *string `json:"website"`
		}
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if strings.TrimSpace(req.Name) == "" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("company name is required"))
			return
		}
		row, err := s.createCompany(r.Context(), strings.TrimSpace(req.Name), req.Website)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusCreated, row)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) company(w http.ResponseWriter, r *http.Request) {
	companyID := r.PathValue("companyId")
	switch r.Method {
	case http.MethodGet:
		row, err := s.getCompany(r.Context(), companyID)
		writeOne(w, row, err)
	case http.MethodPatch:
		var req struct {
			Name    *string `json:"name"`
			Website *string `json:"website"`
		}
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if req.Name != nil {
			existing, err := s.getCompany(r.Context(), companyID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			if existing != nil && asString(existing["name"]) == unknownCompanyName && strings.TrimSpace(*req.Name) != unknownCompanyName {
				writeError(w, http.StatusForbidden, fmt.Errorf("the Unknown placeholder company cannot be renamed"))
				return
			}
		}
		row, err := s.updateCompany(r.Context(), companyID, req.Name, req.Website)
		writeOne(w, row, err)
	case http.MethodDelete:
		row, err := s.getCompany(r.Context(), companyID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if row != nil && asString(row["name"]) == unknownCompanyName {
			writeError(w, http.StatusForbidden, fmt.Errorf("the Unknown placeholder company cannot be deleted"))
			return
		}
		s.writeNoContentQuery(w, r, "DELETE "+recordID("companies", companyID)+";")
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) applications(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := queryRows(r.Context(), s.app.DB, applicationListQuery)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	case http.MethodPost:
		var req struct {
			Name              string   `json:"name"`
			CompanyID         string   `json:"company_id"`
			CompanyName       string   `json:"company_name"`
			Position          string   `json:"position"`
			JobDescriptionURL string   `json:"job_description_url"`
			Status            string   `json:"status"`
			SharedWith        []string `json:"shared_with"`
		}
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		jobURL := strings.TrimSpace(req.JobDescriptionURL)
		// Recognize known job boards (Greenhouse, Lever, Ashby, Workday, …)
		// from the posting URL. When matched, the parsed identity lets us
		// (a) reuse an existing employer company that has already posted on
		// the same board, and (b) tag whichever company we end up using so
		// future postings dedupe automatically. A future "watch this board
		// for new openings" agent can read the same identities back.
		boardMatch := parseJobBoardURL(jobURL)
		var companyID, companyName string
		userSuppliedCompany := strings.TrimSpace(req.CompanyID) != "" || strings.TrimSpace(req.CompanyName) != ""
		if !userSuppliedCompany && boardMatch != nil {
			existing, err := s.findCompanyByJobBoardIdentity(r.Context(), boardMatch.Identity)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			if existing != nil {
				companyID = trimRecord(asString(existing["id"]))
				companyName = asString(existing["name"])
			}
		}
		if companyID == "" {
			id, resolvedName, err := s.resolveCompanyForApplication(r.Context(), req.CompanyID, req.CompanyName)
			if err != nil {
				writeError(w, http.StatusBadRequest, err)
				return
			}
			companyID, companyName = id, resolvedName
		}
		position := strings.TrimSpace(req.Position)
		name := strings.TrimSpace(req.Name)
		jobPage := s.fetchJobPage(r.Context(), jobURL)
		if name == "" {
			name = s.resolveApplicationName(r.Context(), position, companyName, jobPage)
		}
		// If the user didn't supply a company and we landed on Unknown,
		// upgrade to a real company. Prefer the URL-parsed slug (deterministic,
		// no LLM) over the LLM-extracted "Role at Company" form.
		if !userSuppliedCompany && companyName == unknownCompanyName {
			if boardMatch != nil {
				row, err := s.createCompanyWithIdentities(r.Context(), boardMatch.CompanyHint, nil, []string{boardMatch.Identity})
				if err == nil && row != nil {
					companyID = trimRecord(asString(row["id"]))
					companyName = asString(row["name"])
				}
			} else if extracted := companyFromGeneratedName(name); extracted != "" {
				if id, resolved, err := s.resolveCompanyForApplication(r.Context(), "", extracted); err == nil {
					companyID = id
					companyName = resolved
				}
			}
		}
		// Tag whichever company we ended up with so the next posting on the
		// same board for the same employer reuses this company automatically.
		// Skip the Unknown placeholder — that's a catch-all, not an employer.
		if boardMatch != nil && companyID != "" && companyName != unknownCompanyName {
			if err := s.appendCompanyJobBoardIdentity(r.Context(), companyID, boardMatch.Identity); err != nil {
				// Non-fatal: identity attach failure shouldn't block create.
				_ = err
			}
		}
		status := req.Status
		if status == "" {
			status = "in_progress"
		} else if status != "in_progress" && status != "closed" {
			writeError(w, http.StatusBadRequest, fmt.Errorf("status must be 'in_progress' or 'closed'"))
			return
		}
		var jobURLPtr *string
		if jobURL != "" {
			jobURLPtr = &jobURL
		}
		row, err := s.createApplication(r.Context(), createApplicationInput{
			Name:              name,
			CompanyID:         companyID,
			JobDescriptionURL: jobURLPtr,
			Status:            status,
			SharedWith:        req.SharedWith,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if jobPage != nil {
			if applicationID := trimRecord(asString(row["id"])); applicationID != "" {
				if s.ingestJobDescription(r.Context(), applicationID, jobPage) {
					row["job_description_ingested"] = true
					row["document_count"] = 1
				}
			}
		}
		writeJSON(w, http.StatusCreated, row)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) application(w http.ResponseWriter, r *http.Request) {
	applicationID := r.PathValue("applicationId")
	switch r.Method {
	case http.MethodGet:
		row, err := s.getApplication(r.Context(), applicationID)
		writeOne(w, row, err)
	case http.MethodPatch:
		var req struct {
			Name              *string  `json:"name"`
			CompanyID         *string  `json:"company_id"`
			JobDescriptionURL *string  `json:"job_description_url"`
			Status            *string  `json:"status"`
			SharedWith        []string `json:"shared_with"`
		}
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if req.Status != nil {
			switch *req.Status {
			case "in_progress", "closed":
			default:
				writeError(w, http.StatusBadRequest, fmt.Errorf("status must be 'in_progress' or 'closed'"))
				return
			}
		}
		row, err := s.updateApplication(r.Context(), applicationID, updateApplicationInput{
			Name:              req.Name,
			CompanyID:         req.CompanyID,
			JobDescriptionURL: req.JobDescriptionURL,
			Status:            req.Status,
			SharedWith:        req.SharedWith,
		})
		writeOne(w, row, err)
	case http.MethodDelete:
		if err := localdata.DeleteApplication(r.Context(), s.app.DB, applicationID); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) applicationDocuments(w http.ResponseWriter, r *http.Request) {
	s.writeQueryRows(w, r, documentListQuery("application_id = "+recordID("applications", r.PathValue("applicationId"))))
}

func (s *Server) attachApplicationDocument(w http.ResponseWriter, r *http.Request) {
	row, err := s.assignDocument(r.Context(), r.PathValue("documentId"), r.PathValue("applicationId"), nil)
	writeOne(w, row, err)
}

func (s *Server) uploadApplicationDocument(w http.ResponseWriter, r *http.Request) {
	applicationID := r.PathValue("applicationId")
	doc, err := s.uploadFromRequest(r, &applicationID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, doc)
}

func (s *Server) applicationPeople(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.peopleResponse())
}

func (s *Server) applicationChats(w http.ResponseWriter, r *http.Request) {
	s.writeQueryRows(w, r, chatListQuery("application_id = "+recordID("applications", r.PathValue("applicationId"))))
}

func (s *Server) createFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name           string  `json:"name"`
		ParentFolderID *string `json:"parent_folder_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.Name == "" {
		req.Name = "Untitled Folder"
	}
	row, err := s.upsertFolder(r.Context(), "", r.PathValue("applicationId"), req.Name, req.ParentFolderID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) updateFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name           *string `json:"name"`
		ParentFolderID *string `json:"parent_folder_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	row, err := s.updateFolderRecord(r.Context(), r.PathValue("folderId"), req.Name, req.ParentFolderID)
	writeOne(w, row, err)
}

func (s *Server) deleteFolder(w http.ResponseWriter, r *http.Request) {
	s.writeNoContentQuery(w, r, "DELETE "+recordID("application_folders", r.PathValue("folderId"))+";")
}

func (s *Server) moveDocument(w http.ResponseWriter, r *http.Request) {
	var req struct {
		FolderID *string `json:"folder_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	row, err := s.assignDocument(r.Context(), r.PathValue("documentId"), r.PathValue("applicationId"), req.FolderID)
	writeOne(w, row, err)
}

func (s *Server) documents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := queryRows(r.Context(), s.app.DB, documentListQuery("true"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	case http.MethodPost:
		doc, err := s.uploadFromRequest(r, nil)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusCreated, doc)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) document(w http.ResponseWriter, r *http.Request) {
	s.writeNoContentQuery(w, r, "DELETE "+recordID("documents", r.PathValue("documentId"))+";")
}

func (s *Server) displayDocument(w http.ResponseWriter, r *http.Request) {
	version, err := s.resolveDocumentVersion(r.Context(), r.PathValue("documentId"), r.URL.Query().Get("version_id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	data, err := localdata.ReadLocalFile(s.app.LocalStorageRoot, version.StoragePath)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	body, contentType := displayBytes(version.Filename, data)
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func (s *Server) docxDocument(w http.ResponseWriter, r *http.Request) {
	s.serveDocumentBytes(w, r, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
}

func (s *Server) documentURL(w http.ResponseWriter, r *http.Request) {
	version, err := s.resolveDocumentVersion(r.Context(), r.PathValue("documentId"), r.URL.Query().Get("version_id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	token, err := localdata.CreateDownloadToken(r.Context(), s.app.DB, map[string]any{
		"storage_path": version.StoragePath,
		"filename":     version.Filename,
	}, time.Hour)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url":        "/download/" + token.Token,
		"filename":   version.Filename,
		"version_id": version.ID,
	})
}

func (s *Server) zipDocuments(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DocumentIDs []string `json:"document_ids"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	data, err := s.zipDocumentBytes(r.Context(), req.DocumentIDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) documentVersions(w http.ResponseWriter, r *http.Request) {
	versions, err := s.listDocumentVersions(r.Context(), r.PathValue("documentId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, versions)
}

func (s *Server) uploadDocumentVersion(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("documentId")
	doc, err := s.uploadVersionFromRequest(r, docID, "user_upload")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, doc)
}

func (s *Server) renameDocumentVersion(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DisplayName *string `json:"display_name"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	displayName := "Version"
	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}
	versionID := r.PathValue("versionId")
	if _, err := s.app.DB.Query(r.Context(), "UPDATE "+recordID("document_versions", versionID)+" SET display_name = "+surrealString(displayName)+";"); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	row, err := s.getDocumentVersion(r.Context(), versionID)
	writeOne(w, row, err)
}

func (s *Server) trackedChangeIDs(w http.ResponseWriter, r *http.Request) {
	rows, err := queryRows(r.Context(), s.app.DB, surrealSelect{
		Fields:  []string{"change_id"},
		From:    "document_edits",
		Where:   "document_id = " + recordID("documents", r.PathValue("documentId")),
		OrderBy: []string{"created_at"},
	}.String())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, asString(row["change_id"]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ids": ids})
}

func (s *Server) acceptEdit(w http.ResponseWriter, r *http.Request) {
	s.resolveEdit(w, r, "accepted")
}

func (s *Server) rejectEdit(w http.ResponseWriter, r *http.Request) {
	s.resolveEdit(w, r, "rejected")
}

func (s *Server) chats(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Single chat-collection endpoint with the scope expressed as a
		// query attribute:
		//   no param           → every chat the user can see
		//   application_id=ID  → chats scoped to that application
		//   application_id=none (or empty)
		//                      → standalone chats only (no application)
		// `/applications/{id}/chats` is a back-compat alias that ends
		// up running the same filter against the same handler.
		where := "true"
		switch raw := strings.TrimSpace(r.URL.Query().Get("application_id")); raw {
		case "":
			// no filter
		case "none":
			where = "application_id = NONE"
		default:
			where = "application_id = " + recordID("applications", raw)
		}
		rows, err := queryRows(r.Context(), s.app.DB, chatListQuery(where))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	case http.MethodPost:
		var req struct {
			ApplicationID           *string `json:"application_id"`
			InitialAssistantMessage string  `json:"initial_assistant_message"`
		}
		_ = decodeJSON(r, &req)
		row, err := s.createChat(r.Context(), req.ApplicationID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if greeting := strings.TrimSpace(req.InitialAssistantMessage); greeting != "" {
			chatID := trimRecord(asString(row["id"]))
			if chatID != "" {
				if err := s.seedAssistantGreeting(r.Context(), chatID, greeting); err != nil {
					writeError(w, http.StatusInternalServerError, err)
					return
				}
			}
		}
		writeJSON(w, http.StatusCreated, map[string]any{"id": row["id"]})
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	chatID := trimRecord(recordID("chats", r.PathValue("chatId")))
	switch r.Method {
	case http.MethodGet:
		detail, err := s.chatDetail(r.Context(), chatID)
		writeOne(w, detail, err)
	case http.MethodPatch:
		var req struct {
			Title *string `json:"title"`
		}
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if req.Title != nil {
			if _, err := s.app.DB.Query(r.Context(), "UPDATE "+recordID("chats", chatID)+" SET title = "+surrealString(*req.Title)+";"); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
		}
		rows, err := queryRows(r.Context(), s.app.DB, chatListQuery("id = "+recordID("chats", chatID)))
		writeFirst(w, rows, err)
	case http.MethodDelete:
		_, deleteSpan := startLocalSpan(r.Context(), "chat.delete",
			attribute.String("chat.id", chatID),
			attribute.String("chat.record_id", recordID("chats", chatID)),
			attribute.String("user.id", localdata.UserFromContext(r.Context()).UserID),
		)
		_, err := s.app.DB.Query(r.Context(), "DELETE "+recordID("chats", chatID)+";")
		recordSpanError(deleteSpan, err)
		deleteSpan.End()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) globalChatStream(w http.ResponseWriter, r *http.Request) {
	s.chatStream(w, r, nil)
}

func (s *Server) applicationChatStream(w http.ResponseWriter, r *http.Request) {
	applicationID := r.PathValue("applicationId")
	s.chatStream(w, r, &applicationID)
}

func (s *Server) generateChatTitle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Message string `json:"message"`
	}
	_ = decodeJSON(r, &req)
	if strings.TrimSpace(req.Message) == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("message is required"))
		return
	}
	title, err := s.completeText(r.Context(), completionRequest{
		Model: defaultTitleModel,
		User:  "Generate a concise title (3-6 words) for this chat. Return only the title.\n\nMessage: " + req.Message,
	})
	if err != nil || strings.TrimSpace(title) == "" {
		title = req.Message
	}
	title = strings.TrimSpace(title)
	if len(title) > 60 {
		title = title[:60]
	}
	writeJSON(w, http.StatusOK, map[string]any{"title": title})
}

func (s *Server) workflows(w http.ResponseWriter, r *http.Request) {
	listQuery := "SELECT id, user_id, title, type, prompt_md, columns_config, is_system, created_at, practice, row_mode, anchor_extractor, true AS is_owner FROM workflows"
	if workflowType := strings.TrimSpace(r.URL.Query().Get("type")); workflowType != "" {
		listQuery += " WHERE type = " + surrealString(workflowType)
	}
	listQuery += " ORDER BY created_at;"
	s.writeListOrCreate(w, r, listQuery, func() (map[string]any, error) {
		return decodeAndCreate(r, s.upsertWorkflow, "")
	})
}

func (s *Server) workflow(w http.ResponseWriter, r *http.Request) {
	workflowID := r.PathValue("workflowId")
	switch r.Method {
	case http.MethodGet:
		rows, err := queryRows(r.Context(), s.app.DB, "SELECT id, user_id, title, type, prompt_md, columns_config, is_system, created_at, practice, row_mode, anchor_extractor, true AS is_owner FROM "+recordID("workflows", workflowID)+";")
		writeFirst(w, rows, err)
	case http.MethodPut, http.MethodPatch:
		var req workflowPayload
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		row, err := s.upsertWorkflow(r.Context(), workflowID, req)
		writeOne(w, row, err)
	case http.MethodDelete:
		if _, err := s.app.DB.Query(r.Context(), "DELETE "+recordID("workflows", workflowID)+";"); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) hiddenWorkflows(w http.ResponseWriter, r *http.Request) {
	rows, err := queryRows(r.Context(), s.app.DB, "SELECT workflow_id FROM hidden_workflows WHERE user_id = users:local;")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, asString(row["workflow_id"]))
	}
	writeJSON(w, http.StatusOK, ids)
}

func (s *Server) hideWorkflow(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WorkflowID string `json:"workflow_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if _, err := s.app.DB.Query(r.Context(), "UPSERT "+recordID("hidden_workflows", req.WorkflowID)+" CONTENT { user_id: users:local, workflow_id: "+surrealString(req.WorkflowID)+", created_at: time::now() };"); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) unhideWorkflow(w http.ResponseWriter, r *http.Request) {
	s.writeNoContentQuery(w, r, "DELETE "+recordID("hidden_workflows", r.PathValue("workflowId"))+";")
}

func (s *Server) workflowShares(w http.ResponseWriter, r *http.Request) {
	s.writeQueryRows(w, r, "SELECT id, shared_with_email, allow_edit, created_at FROM workflow_shares WHERE workflow_id = "+recordID("workflows", r.PathValue("workflowId"))+" ORDER BY created_at;")
}

func (s *Server) shareWorkflow(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Emails    []string `json:"emails"`
		AllowEdit bool     `json:"allow_edit"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	for _, email := range req.Emails {
		email = strings.TrimSpace(strings.ToLower(email))
		if email == "" {
			continue
		}
		if _, err := s.app.DB.Query(r.Context(), fmt.Sprintf(`
			UPSERT %s CONTENT {
				workflow_id: %s,
				shared_by_user_id: users:local,
				shared_with_email: %s,
				allow_edit: %t,
				created_at: time::now()
			};
		`, recordID("workflow_shares", r.PathValue("workflowId")+"_"+email), recordID("workflows", r.PathValue("workflowId")), surrealString(email), req.AllowEdit)); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteWorkflowShare(w http.ResponseWriter, r *http.Request) {
	s.writeNoContentQuery(w, r, "DELETE "+recordID("workflow_shares", r.PathValue("shareId"))+";")
}

func (s *Server) tabularReviews(w http.ResponseWriter, r *http.Request) {
	// document_count is the distinct doc id count across both backing tables:
	// tabular_cells (document-row mode) and tabular_review_rows (entity-row).
	// A given review only populates one of them, so the union covers both.
	s.writeListOrCreate(w, r, `SELECT id, application_id, user_id, title, columns_config, workflow_id, practice, row_mode, anchor_extractor, created_at, updated_at,
		array::len(array::distinct(array::concat(
			(SELECT VALUE document_id FROM tabular_cells WHERE review_id = $parent.id),
			(SELECT VALUE document_id FROM tabular_review_rows WHERE review_id = $parent.id)
		))) AS document_count
	FROM tabular_reviews ORDER BY updated_at DESC;`, func() (map[string]any, error) {
		return decodeAndCreate(r, s.upsertTabularReview, "")
	})
}

func (s *Server) tabularReview(w http.ResponseWriter, r *http.Request) {
	reviewID := r.PathValue("reviewId")
	switch r.Method {
	case http.MethodGet:
		detail, err := s.tabularDetail(r.Context(), reviewID)
		writeOne(w, detail, err)
	case http.MethodPatch:
		var req tabularPayload
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		row, err := s.upsertTabularReview(r.Context(), reviewID, req)
		writeOne(w, row, err)
	case http.MethodDelete:
		if err := localdata.DeleteTabularReview(r.Context(), s.app.DB, reviewID); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func (s *Server) tabularPrompt(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title        string   `json:"title"`
		Format       *string  `json:"format"`
		DocumentName *string  `json:"documentName"`
		Tags         []string `json:"tags"`
	}
	_ = decodeJSON(r, &req)
	raw, err := s.completeText(r.Context(), completionRequest{
		Model:        defaultTitleModel,
		SystemPrompt: `Return only valid JSON with one field: {"prompt": string}.`,
		User:         "Column title: " + req.Title + "\nWrite a legal tabular review extraction prompt.",
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	prompt := strings.TrimSpace(raw)
	var parsed struct {
		Prompt string `json:"prompt"`
	}
	if json.Unmarshal([]byte(prompt), &parsed) == nil && strings.TrimSpace(parsed.Prompt) != "" {
		prompt = strings.TrimSpace(parsed.Prompt)
	}
	writeJSON(w, http.StatusOK, map[string]any{"prompt": prompt, "source": "llm"})
}

func (s *Server) tabularGenerate(w http.ResponseWriter, r *http.Request) {
	reviewID := r.PathValue("reviewId")
	var req struct {
		DocumentIDs    []string `json:"document_ids"`
		ColumnIndices  []int    `json:"column_indices"`
		ColumnIndexAlt []int    `json:"columnIndices"`
	}
	_ = decodeJSON(r, &req)
	if len(req.ColumnIndices) == 0 {
		req.ColumnIndices = req.ColumnIndexAlt
	}
	if len(req.ColumnIndices) == 0 {
		req.ColumnIndices = []int{0}
	}

	ctx, span := startLocalSpan(r.Context(), "tabular.generate",
		attribute.String("tabular_review.id", reviewID),
		attribute.Int("tabular.documents.count", len(req.DocumentIDs)),
		attribute.Int("tabular.columns.count", len(req.ColumnIndices)),
		attribute.Int("tabular.cells.expected", len(req.DocumentIDs)*len(req.ColumnIndices)),
	)
	defer span.End()

	if len(req.DocumentIDs) == 0 {
		err := fmt.Errorf("document_ids is required")
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.exit_reason", "bad_request"))
		writeError(w, http.StatusBadRequest, err)
		return
	}

	var (
		cellsDone   int
		cellsFailed int
	)

	// Load review meta (row_mode + anchor extractor + columns) in one go.
	meta, metaErr := s.loadTabularReviewMeta(ctx, reviewID)
	if metaErr != nil {
		recordSpanError(span, metaErr)
		span.SetAttributes(attribute.String("tabular.exit_reason", "columns_load_failed"))
		writeError(w, http.StatusInternalServerError, metaErr)
		return
	}
	columnSpecs := meta.ColumnSpecs
	span.SetAttributes(
		attribute.Int("tabular.columns.loaded", len(columnSpecs)),
		attribute.String("tabular.row_mode", meta.RowMode),
	)

	// Entity-row mode runs its own pipeline: per-document anchor extraction →
	// row creation → per-row column generation. Filter cellsDone/cellsFailed
	// updates flow through the closure variables below.
	if meta.RowMode == "entity" {
		s.runEntityModeGenerate(ctx, w, span, reviewID, req.DocumentIDs, req.ColumnIndices, meta, &cellsDone, &cellsFailed)
		return
	}

	var streamErr error
	streamSSE(ctx, w, func(send func(map[string]any) error) error {
		for _, docID := range req.DocumentIDs {
			// One text load per document, reused across columns.
			docText, docFilename, docErr := s.loadDocumentForTabular(ctx, docID)
			if docErr != nil {
				// Don't abort the whole stream — emit error cells for this doc and continue.
				for _, column := range req.ColumnIndices {
					_, cellSpan := startLocalSpan(ctx, "tabular.cell.generate",
						attribute.String("tabular_review.id", reviewID),
						attribute.String("tabular.document.id", docID),
						attribute.Int("tabular.column.index", column),
						attribute.String("tabular.cell.status", "document_load_failed"),
					)
					recordSpanError(cellSpan, docErr)
					cellSpan.End()
					cellsFailed++
				}
				continue
			}
			for _, column := range req.ColumnIndices {
				cellCtx, cellSpan := startLocalSpan(ctx, "tabular.cell.generate",
					attribute.String("tabular_review.id", reviewID),
					attribute.String("tabular.document.id", docID),
					attribute.Int("tabular.column.index", column),
					attribute.Int("tabular.document.text_chars", len(docText)),
					attribute.String("tabular.document.filename", docFilename),
				)
				spec, hasSpec := columnSpecs[column]
				if !hasSpec || strings.TrimSpace(spec.Prompt) == "" {
					cellSpan.SetAttributes(attribute.String("tabular.cell.status", "no_column_prompt"))
					cellSpan.End()
					cellsFailed++
					continue
				}
				cellSpan.SetAttributes(
					attribute.String("tabular.column.name", spec.Name),
					attribute.String("tabular.column.format", spec.Format),
					attribute.Int("tabular.column.prompt_chars", len(spec.Prompt)),
				)
				summary, err := s.completeText(cellCtx, completionRequest{
					Model:        defaultMainModel,
					SystemPrompt: tabularCellSystemPrompt(),
					User:         tabularCellUserPrompt(spec, docFilename, docText),
				})
				if err != nil {
					cellsFailed++
					cellSpan.SetAttributes(attribute.String("tabular.cell.status", "llm_failed"))
					recordSpanError(cellSpan, err)
					cellSpan.End()
					streamErr = err
					return err
				}
				trimmed := strings.TrimSpace(summary)
				if trimmed == "" {
					trimmed = "Not addressed"
					cellSpan.SetAttributes(attribute.Bool("tabular.cell.fell_back_to_default", true))
				}
				cellSpan.SetAttributes(attribute.Int("tabular.cell.summary_chars", len(trimmed)))
				cell, err := s.upsertCellWithContent(cellCtx, reviewID, docID, column, trimmed, "done")
				if err != nil {
					cellsFailed++
					cellSpan.SetAttributes(attribute.String("tabular.cell.status", "persist_failed"))
					recordSpanError(cellSpan, err)
					cellSpan.End()
					streamErr = err
					return err
				}
				if err := send(map[string]any{
					"type":         "cell_update",
					"document_id":  docID,
					"column_index": column,
					"content":      map[string]any{"summary": trimmed},
					"status":       "done",
					"cell":         cell,
				}); err != nil {
					cellsFailed++
					cellSpan.SetAttributes(attribute.String("tabular.cell.status", "send_failed"))
					recordSpanError(cellSpan, err)
					cellSpan.End()
					streamErr = err
					return err
				}
				cellsDone++
				cellSpan.SetAttributes(attribute.String("tabular.cell.status", "done"))
				cellSpan.End()
			}
		}
		return send(map[string]any{"type": "done"})
	})
	span.SetAttributes(
		attribute.Int("tabular.cells.done", cellsDone),
		attribute.Int("tabular.cells.failed", cellsFailed),
	)
	if streamErr != nil {
		recordSpanError(span, streamErr)
		span.SetAttributes(attribute.String("tabular.exit_reason", "stream_failed"))
	} else {
		span.SetAttributes(attribute.String("tabular.exit_reason", "done"))
	}
}

type tabularColumnSpec struct {
	Index  int
	Name   string
	Prompt string
	Format string
}

func (s *Server) loadTabularColumnSpecs(ctx context.Context, reviewID string) (map[int]tabularColumnSpec, error) {
	rows, err := queryRows(ctx, s.app.DB, "SELECT columns_config FROM "+recordID("tabular_reviews", reviewID)+";")
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("tabular review not found: %s", reviewID)
	}
	out := map[int]tabularColumnSpec{}
	items, _ := rows[0]["columns_config"].([]any)
	for i, item := range items {
		m, _ := item.(map[string]any)
		idx := asInt(m["index"])
		if idx == 0 && i != 0 {
			idx = i
		}
		out[idx] = tabularColumnSpec{
			Index:  idx,
			Name:   asString(m["name"]),
			Prompt: asString(m["prompt"]),
			Format: asString(m["format"]),
		}
	}
	return out, nil
}

func (s *Server) loadDocumentForTabular(ctx context.Context, documentID string) (string, string, error) {
	doc, err := s.readAssistantDocument(ctx, documentID)
	if err != nil {
		return "", "", err
	}
	text := ""
	filename := ""
	if doc != nil {
		if doc.Text != nil {
			text = *doc.Text
		}
		if doc.Filename != nil {
			filename = *doc.Filename
		}
	}
	return text, filename, nil
}

func tabularCellSystemPrompt() string {
	return "You are a precise document-analysis assistant filling one cell of a tabular review. " +
		"Use ONLY the document text provided to answer. " +
		"If the document does not contain the requested information, respond exactly with \"Not addressed\". " +
		"Do not speculate, do not invent facts, and do not add commentary. " +
		"Return the answer in the requested format with no preamble."
}

func tabularCellUserPrompt(spec tabularColumnSpec, filename, text string) string {
	formatHint := tabularFormatHint(spec.Format)
	var b strings.Builder
	b.WriteString("Column: ")
	if spec.Name != "" {
		b.WriteString(spec.Name)
	} else {
		b.WriteString("Column " + strconv.Itoa(spec.Index))
	}
	b.WriteString("\nFormat: ")
	b.WriteString(formatHint)
	b.WriteString("\n\nTask:\n")
	b.WriteString(spec.Prompt)
	b.WriteString("\n\n--- Document")
	if filename != "" {
		b.WriteString(": ")
		b.WriteString(filename)
	}
	b.WriteString(" ---\n")
	if text == "" {
		b.WriteString("(document has no extractable text)")
	} else {
		b.WriteString(text)
	}
	b.WriteString("\n--- End of document ---\n\nAnswer:")
	return b.String()
}

func tabularFormatHint(format string) string {
	switch format {
	case "bulleted_list":
		return "Bulleted list. One bullet per line starting with \"• \"."
	case "company":
		return "Bulleted list, one company per line in the shape: \"• <Company> — <Role> (<Start Mon YYYY> – <End Mon YYYY or 'Present'>)\"."
	case "number":
		return "A single numeric value, no units."
	case "currency":
		return "ISO-style short currency code only, e.g. USD, EUR, GBP."
	case "yes_no":
		return "Exactly \"Yes\" or \"No\" (or \"Not addressed\" if unknown)."
	case "date":
		return "A single date in \"DD Mon YYYY\" form."
	case "tag":
		return "A short tag value, no sentence."
	case "percentage":
		return "A single percentage, e.g. \"12.5%\"."
	case "monetary_amount":
		return "A single monetary amount with currency and amount, e.g. \"USD 10,000\"."
	default:
		return "Free text. Be concise."
	}
}

func (s *Server) regenerateCell(w http.ResponseWriter, r *http.Request) {
	reviewID := r.PathValue("reviewId")
	ctx, span := startLocalSpan(r.Context(), "tabular.cell.regenerate",
		attribute.String("tabular_review.id", reviewID),
	)
	defer span.End()
	var req struct {
		DocumentID  string `json:"document_id"`
		ColumnIndex int    `json:"column_index"`
	}
	if err := decodeJSON(r, &req); err != nil {
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.exit_reason", "bad_request"))
		writeError(w, http.StatusBadRequest, err)
		return
	}
	span.SetAttributes(
		attribute.String("tabular.document.id", req.DocumentID),
		attribute.Int("tabular.column.index", req.ColumnIndex),
	)
	columnSpecs, err := s.loadTabularColumnSpecs(ctx, reviewID)
	if err != nil {
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.exit_reason", "columns_load_failed"))
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	spec, hasSpec := columnSpecs[req.ColumnIndex]
	if !hasSpec || strings.TrimSpace(spec.Prompt) == "" {
		err = fmt.Errorf("column %d has no prompt configured", req.ColumnIndex)
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.exit_reason", "no_column_prompt"))
		writeError(w, http.StatusBadRequest, err)
		return
	}
	span.SetAttributes(
		attribute.String("tabular.column.name", spec.Name),
		attribute.String("tabular.column.format", spec.Format),
	)
	docText, docFilename, err := s.loadDocumentForTabular(ctx, req.DocumentID)
	if err != nil {
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.exit_reason", "document_load_failed"))
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	span.SetAttributes(
		attribute.String("tabular.document.filename", docFilename),
		attribute.Int("tabular.document.text_chars", len(docText)),
	)
	summary, err := s.completeText(ctx, completionRequest{
		Model:        defaultMainModel,
		SystemPrompt: tabularCellSystemPrompt(),
		User:         tabularCellUserPrompt(spec, docFilename, docText),
	})
	if err != nil {
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.exit_reason", "llm_failed"))
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if strings.TrimSpace(summary) == "" {
		summary = "Not addressed"
		span.SetAttributes(attribute.Bool("tabular.cell.fell_back_to_default", true))
	}
	trimmed := strings.TrimSpace(summary)
	span.SetAttributes(attribute.Int("tabular.cell.summary_chars", len(trimmed)))
	_, err = s.upsertCellWithContent(ctx, reviewID, req.DocumentID, req.ColumnIndex, trimmed, "done")
	if err != nil {
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.exit_reason", "persist_failed"))
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	span.SetAttributes(attribute.String("tabular.exit_reason", "done"))
	writeJSON(w, http.StatusOK, map[string]any{"summary": trimmed})
}

func (s *Server) clearCells(w http.ResponseWriter, r *http.Request) {
	ctx, span := startLocalSpan(r.Context(), "tabular.cells.clear",
		attribute.String("tabular_review.id", r.PathValue("reviewId")),
	)
	defer span.End()
	*r = *r.WithContext(ctx)
	s.writeNoContentQuery(w, r, "DELETE tabular_cells WHERE review_id = "+recordID("tabular_reviews", r.PathValue("reviewId"))+";")
}

func (s *Server) tabularChats(w http.ResponseWriter, r *http.Request) {
	s.writeQueryRows(w, r, surrealSelect{
		Fields:  []string{"id", "review_id AS application_id", "user_id", "title", "created_at"},
		From:    "tabular_review_chats",
		Where:   "review_id = " + recordID("tabular_reviews", r.PathValue("reviewId")),
		OrderBy: []string{"updated_at DESC"},
	}.String())
}

func (s *Server) deleteTabularChat(w http.ResponseWriter, r *http.Request) {
	s.writeNoContentQuery(w, r, "DELETE "+recordID("tabular_review_chats", r.PathValue("chatId"))+";")
}

func (s *Server) tabularChatMessages(w http.ResponseWriter, r *http.Request) {
	s.writeQueryRows(w, r, "SELECT id, chat_id, created_at, role, content, annotations FROM tabular_review_chat_messages WHERE chat_id = "+recordID("tabular_review_chats", r.PathValue("chatId"))+" ORDER BY created_at;")
}

func (s *Server) tabularChatStream(w http.ResponseWriter, r *http.Request) {
	ctx, span := startLocalSpan(r.Context(), "api.tabular_chat_stream",
		attribute.String("tabular_review.id", r.PathValue("reviewId")),
	)
	r = r.WithContext(ctx)
	defer span.End()
	reviewID := r.PathValue("reviewId")
	var req struct {
		ChatID   *string              `json:"chat_id"`
		Model    *string              `json:"model"`
		Messages []chatRequestMessage `json:"messages"`
	}
	_ = decodeJSON(r, &req)
	chatID := ""
	if req.ChatID != nil {
		chatID = *req.ChatID
	}
	span.SetAttributes(
		attribute.Bool("chat.existing", chatID != ""),
		attribute.Int("chat.request_message_count", len(req.Messages)),
		attribute.String("assistant.model", modelOrDefault(req.Model)),
	)
	if chatID == "" {
		row, err := s.createTabularChat(r.Context(), reviewID)
		if err != nil {
			recordSpanError(span, err)
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		chatID = trimRecord(asString(row["id"]))
	}
	span.SetAttributes(attribute.String("chat.id", chatID))
	streamSSE(r.Context(), w, func(send func(map[string]any) error) error {
		text, err := s.persistAndStreamAssistantTabularChat(r.Context(), reviewID, chatID, req.Model, req.Messages, send)
		if err != nil {
			recordSpanError(span, err)
			return err
		}
		span.SetAttributes(attribute.Int("assistant.response_chars", len(text)))
		_ = text
		return nil
	})
}

func (s *Server) downloadToken(w http.ResponseWriter, r *http.Request) {
	token, err := localdata.ResolveDownloadToken(r.Context(), s.app.DB, r.PathValue("token"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	storagePath := asString(token.Payload["storage_path"])
	data, err := localdata.ReadLocalFile(s.app.LocalStorageRoot, storagePath)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	filename := asString(token.Payload["filename"])
	w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(filename)))
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) updateProfile(ctx context.Context, body map[string]any) error {
	sets := []string{"updated_at = time::now()"}
	for jsonKey, field := range map[string]string{
		"display_name":   "display_name",
		"organisation":   "organisation",
		"tabular_model":  "tabular_model",
		"claude_api_key": "claude_api_key",
		"gemini_api_key": "gemini_api_key",
	} {
		if value, ok := body[jsonKey].(string); ok {
			sets = append(sets, field+" = "+optionString(value))
		}
	}
	_, err := s.app.DB.Query(ctx, "UPDATE user_profiles SET "+strings.Join(sets, ", ")+" WHERE user_id = users:local;")
	return err
}

func (s *Server) loadProfile(ctx context.Context) (map[string]any, error) {
	rows, err := queryRows(ctx, s.app.DB, `SELECT id, display_name, organisation, tier, message_credits_used, credits_reset_date, tabular_model, claude_api_key, gemini_api_key FROM user_profiles WHERE user_id = users:local;`)
	if err != nil {
		return nil, err
	}
	profile := map[string]any{
		"ok":       true,
		"id":       localdata.LocalUserID,
		"email":    localdata.LocalUserEmail,
		"settings": map[string]any{},
	}
	if len(rows) == 0 {
		return profile, nil
	}
	row := rows[0]
	profile["display_name"] = row["display_name"]
	profile["tier"] = row["tier"]
	profile["credits"] = row["message_credits_used"]
	profile["credits_reset_at"] = row["credits_reset_date"]
	profile["settings"] = map[string]any{
		"organisation":   row["organisation"],
		"tabular_model":  row["tabular_model"],
		"claude_api_key": row["claude_api_key"],
		"gemini_api_key": row["gemini_api_key"],
	}
	return profile, nil
}

func (s *Server) uploadFromRequest(r *http.Request, applicationID *string) (map[string]any, error) {
	file, header, err := r.FormFile("file")
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	filename := header.Filename
	if filename == "" {
		filename = "upload.bin"
	}
	docID := newID("doc")
	versionID := docID + "_v1"
	storagePath := filepath.ToSlash(filepath.Join(docID, filename))
	payload := map[string]any{
		"document_id":    docID,
		"version_id":     versionID,
		"filename":       filename,
		"file_type":      strings.TrimPrefix(filepath.Ext(filename), "."),
		"storage_path":   storagePath,
		"size_bytes":     len(data),
		"version_number": 1,
		"content_base64": encodeBase64(data),
	}
	if applicationID != nil {
		payload["application_id"] = *applicationID
	}
	if _, err := localdata.PersistDocumentOperation(
		localdata.WithUserContext(r.Context(), s.app.User),
		s.app,
		localdata.DocumentOperationInput{
			WorkflowName: localdata.DocumentUploadWorkflowName,
			TargetID:     docID,
			Payload:      payload,
		},
	); err != nil {
		return nil, err
	}
	if applicationID != nil {
		if _, err := s.app.DB.Query(r.Context(), "UPDATE "+recordID("documents", docID)+" SET application_id = "+recordID("applications", *applicationID)+", updated_at = time::now();"); err != nil {
			return nil, err
		}
	}
	return s.getDocument(r.Context(), docID)
}

func (s *Server) uploadVersionFromRequest(r *http.Request, documentID, source string) (map[string]any, error) {
	file, header, err := r.FormFile("file")
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, err
	}
	versionNumber, err := s.nextVersionNumber(r.Context(), documentID)
	if err != nil {
		return nil, err
	}
	versionID := documentID + "_v" + strconv.Itoa(versionNumber)
	filename := header.Filename
	if filename == "" {
		filename = "version.bin"
	}
	storagePath := filepath.ToSlash(filepath.Join(documentID, versionID, filename))
	if writeErr := localdata.WriteLocalFileAtomic(s.app.LocalStorageRoot, storagePath, data); writeErr != nil {
		return nil, writeErr
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
	`, recordID("document_versions", versionID), recordID("documents", documentID), surrealString(storagePath), surrealString(source), versionNumber, surrealString(filename), recordID("documents", documentID), recordID("document_versions", versionID)))
	if err != nil {
		return nil, err
	}
	return s.getDocumentVersion(r.Context(), versionID)
}

func (s *Server) serveDocumentBytes(w http.ResponseWriter, r *http.Request, contentType string) {
	version, err := s.resolveDocumentVersion(r.Context(), r.PathValue("documentId"), r.URL.Query().Get("version_id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	data, err := localdata.ReadLocalFile(s.app.LocalStorageRoot, version.StoragePath)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (s *Server) zipDocumentBytes(ctx context.Context, documentIDs []string) ([]byte, error) {
	buf := &bytes.Buffer{}
	zipper := zip.NewWriter(buf)
	for _, docID := range documentIDs {
		version, err := s.resolveDocumentVersion(ctx, docID, "")
		if err != nil {
			return nil, err
		}
		data, err := localdata.ReadLocalFile(s.app.LocalStorageRoot, version.StoragePath)
		if err != nil {
			return nil, err
		}
		writer, err := zipper.Create(version.Filename)
		if err != nil {
			return nil, err
		}
		if _, err := writer.Write(data); err != nil {
			return nil, err
		}
	}
	if err := zipper.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (s *Server) chatStream(w http.ResponseWriter, r *http.Request, applicationID *string) {
	if chatv2.Enabled() {
		s.chatStreamV2(w, r, applicationID)
		return
	}
	ctx, span := startLocalSpan(r.Context(), "api.chat_stream")
	r = r.WithContext(ctx)
	defer span.End()
	var req struct {
		ChatID            *string              `json:"chat_id"`
		Model             *string              `json:"model"`
		Messages          []chatRequestMessage `json:"messages"`
		DisplayedDoc      *chatRequestFile     `json:"displayed_doc"`
		AttachedDocuments []chatRequestFile    `json:"attached_documents"`
	}
	_ = decodeJSON(r, &req)
	chatID := ""
	requestedChatID := ""
	if req.ChatID != nil {
		requestedChatID = *req.ChatID
		chatID = trimRecord(recordID("chats", requestedChatID))
	}
	span.SetAttributes(
		attribute.Bool("chat.existing", chatID != ""),
		attribute.String("chat.requested_id", requestedChatID),
		attribute.Int("chat.request_message_count", len(req.Messages)),
		attribute.Int("chat.attached_document_count", len(req.AttachedDocuments)),
		attribute.Bool("chat.has_displayed_doc", req.DisplayedDoc != nil),
		attribute.String("assistant.model", modelOrDefault(req.Model)),
	)
	if applicationID != nil {
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	if chatID == "" {
		row, err := s.createChat(r.Context(), applicationID)
		if err != nil {
			recordSpanError(span, err)
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		chatID = trimRecord(asString(row["id"]))
	}
	span.SetAttributes(attribute.String("chat.id", chatID))
	streamSSE(r.Context(), w, func(send func(map[string]any) error) error {
		err := s.streamChatExecutionWorkflow(r.Context(), send, chatExecutionInput{
			ChatID:            chatID,
			Model:             req.Model,
			ApplicationID:     applicationID,
			Messages:          req.Messages,
			DisplayedDoc:      req.DisplayedDoc,
			AttachedDocuments: req.AttachedDocuments,
		})
		recordSpanError(span, err)
		return err
	})
}

// chatStreamV2 dispatches the chat to the V2 workflow path.
func (s *Server) chatStreamV2(w http.ResponseWriter, r *http.Request, applicationID *string) {
	ctx, span := startLocalSpan(r.Context(), "api.chat_stream_v2")
	r = r.WithContext(ctx)
	defer span.End()
	if applicationID != nil {
		span.SetAttributes(attribute.String("application.id", *applicationID))
	}
	chatv2.Handler(s.chatV2HandlerDeps(), applicationID)(w, r)
}

func streamSSE(ctx context.Context, w http.ResponseWriter, fn func(func(map[string]any) error) error) {
	_, span := startLocalSpan(ctx, "api.sse_stream")
	defer span.End()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	eventCount := 0
	send := func(payload map[string]any) error {
		eventType, _ := payload["type"].(string)
		span.AddEvent("api.sse_send", trace.WithAttributes(attribute.String("sse.event_type", eventType)))
		data, err := json.Marshal(payload)
		if err != nil {
			recordSpanError(span, err)
			return err
		}
		if _, err := fmt.Fprintf(w, "event: message\ndata: %s\n\n", data); err != nil {
			recordSpanError(span, err)
			return err
		}
		eventCount++
		if flusher != nil {
			flusher.Flush()
		}
		return nil
	}
	if err := fn(send); err != nil {
		recordSpanError(span, err)
		_ = send(map[string]any{"type": "error", "error": err.Error()})
	}
	span.SetAttributes(attribute.Int("sse.event_count", eventCount))
}

func queryRows(ctx context.Context, db *persistence.DB, query string) ([]map[string]any, error) {
	ctx, span := startLocalSpan(ctx, "surreal.query", surrealQueryAttributes(query)...)
	defer span.End()
	result, err := db.Query(ctx, query)
	if err != nil {
		span.SetAttributes(attribute.String("db.statement", truncateStatement(query)))
		recordSpanError(span, err)
		return nil, err
	}
	var statements [][]map[string]any
	if err := json.Unmarshal(result, &statements); err != nil {
		span.SetAttributes(attribute.String("db.statement", truncateStatement(query)))
		recordSpanError(span, err)
		return nil, err
	}
	if len(statements) == 0 {
		span.SetAttributes(attribute.Int("db.statement_count", 0), attribute.Int("db.row_count", 0))
		return nil, nil
	}
	rows := statements[len(statements)-1]
	span.SetAttributes(attribute.Int("db.statement_count", len(statements)), attribute.Int("db.row_count", len(rows)))
	return rows, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) writeQueryRows(w http.ResponseWriter, r *http.Request, query string) {
	rows, err := queryRows(r.Context(), s.app.DB, query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

func (s *Server) writeNoContentQuery(w http.ResponseWriter, r *http.Request, query string) {
	_, span := startLocalSpan(r.Context(), "surreal.exec", surrealQueryAttributes(query)...)
	defer span.End()
	if _, err := s.app.DB.Query(r.Context(), query); err != nil {
		span.SetAttributes(attribute.String("db.statement", truncateStatement(query)))
		recordSpanError(span, err)
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func truncateStatement(query string) string {
	const max = 2000
	if len(query) <= max {
		return query
	}
	return query[:max] + "…"
}

func (s *Server) writeListOrCreate(w http.ResponseWriter, r *http.Request, listQuery string, create func() (map[string]any, error)) {
	switch r.Method {
	case http.MethodGet:
		s.writeQueryRows(w, r, listQuery)
	case http.MethodPost:
		row, err := create()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusCreated, row)
	default:
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
	}
}

func decodeAndCreate[T any](r *http.Request, create func(context.Context, string, T) (map[string]any, error), id string) (map[string]any, error) {
	var req T
	if err := decodeJSON(r, &req); err != nil {
		return nil, err
	}
	return create(r.Context(), id, req)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"ok": false, "error": err.Error()})
}

func writeOne(w http.ResponseWriter, row any, err error) {
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if row == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("not found"))
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func writeFirst(w http.ResponseWriter, rows []map[string]any, err error) {
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if len(rows) == 0 {
		writeError(w, http.StatusNotFound, fmt.Errorf("not found"))
		return
	}
	writeJSON(w, http.StatusOK, rows[0])
}

func decodeJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return nil
	}
	defer func() { _ = r.Body.Close() }()
	if err := json.NewDecoder(r.Body).Decode(target); err != nil && err != io.EOF {
		return err
	}
	return nil
}
