package localdata

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/i2y/romancy"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/CaliLuke/luke/backend-go/internal/persistence"
	"github.com/CaliLuke/luke/backend-go/internal/textextract"
)

// optionInt returns the SurrealQL int literal when emit is true, else
// "NONE". Used so we only write extracted_text_chars when we actually
// have a non-empty text twin.
func optionInt(value int, emit bool) string {
	if !emit {
		return "NONE"
	}
	return strconv.Itoa(value)
}

// txQuery wraps tx.Query with a span so failures inside workflow
// transactions get the same `db.statement` / `exception.message` capture
// that the queryRows read path produces. Without this, a parse error
// inside a Transaction shows up only as a generic 400 response with no
// telemetry breadcrumb.
func txQuery(ctx context.Context, tx *persistence.Tx, label, statement string) error {
	ctx, span := workflowsTracer.Start(ctx, "surreal.tx_query")
	defer span.End()
	span.SetAttributes(
		attribute.String("db.system", "surrealdb"),
		attribute.String("db.tx_label", label),
	)
	if _, err := tx.Query(ctx, statement); err != nil {
		// Truncate the statement attribute so a 100k-char extracted-text
		// upsert doesn't blow the span size budget.
		const maxStatementChars = 4000
		stmt := statement
		if len(stmt) > maxStatementChars {
			stmt = stmt[:maxStatementChars] + "…"
		}
		span.SetAttributes(attribute.String("db.statement", stmt))
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return err
	}
	return nil
}

var workflowsTracer = otel.Tracer("luke/localdata/workflows")

const (
	DocumentUploadWorkflowName         = "document_upload"
	EditResolutionWorkflowName         = "edit_resolution"
	GeneratedDocumentWorkflowName      = "generated_document_persistence"
	persistDocumentOperationActivityID = "persist_document_operation"
)

type DocumentOperationInput struct {
	AppID        string         `json:"app_id"`
	WorkflowName string         `json:"workflow_name"`
	TargetID     string         `json:"target_id"`
	User         UserContext    `json:"user"`
	Payload      map[string]any `json:"payload"`
}

type DocumentOperationResult struct {
	OperationID string `json:"operation_id"`
	UserID      string `json:"user_id"`
	DocumentID  string `json:"document_id,omitempty"`
	VersionID   string `json:"version_id,omitempty"`
	EditID      string `json:"edit_id,omitempty"`
}

func (in DocumentOperationInput) withDefaults(ctx context.Context) DocumentOperationInput {
	in.User = UserFromContext(ctx)
	if in.Payload == nil {
		in.Payload = map[string]any{}
	}
	return in
}

var persistDocumentOperation = romancy.DefineActivity(
	"persist_document_operation",
	func(ctx context.Context, input DocumentOperationInput) (DocumentOperationResult, error) {
		ctx, span := workflowsTracer.Start(ctx, "document.workflow.persist_activity")
		defer span.End()
		span.SetAttributes(
			attribute.String("workflow.name", input.WorkflowName),
			attribute.String("workflow.target_id", input.TargetID),
			attribute.String("workflow.app_id", input.AppID),
		)
		startedAt := time.Now()
		input = input.withDefaults(ctx)
		if input.WorkflowName == "" {
			err := fmt.Errorf("workflow_name is required")
			span.SetStatus(codes.Error, err.Error())
			return DocumentOperationResult{}, err
		}
		if input.TargetID == "" {
			err := fmt.Errorf("target_id is required")
			span.SetStatus(codes.Error, err.Error())
			return DocumentOperationResult{}, err
		}
		resources, ok := activeWorkflowResources(input.AppID)
		if !ok {
			err := fmt.Errorf("workflow persistence is not initialized")
			span.SetStatus(codes.Error, err.Error())
			return DocumentOperationResult{}, err
		}
		operationID := workflowOperationID(input.WorkflowName, input.TargetID)
		span.SetAttributes(attribute.String("workflow.operation_id", operationID))
		result, err := persistDocumentWorkflowPayload(ctx, &resources, input, operationID)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.SetAttributes(attribute.Float64("workflow.persist_ms", float64(time.Since(startedAt).Milliseconds())))
			return DocumentOperationResult{}, err
		}
		result.OperationID = operationID
		result.UserID = input.User.UserID
		span.SetAttributes(
			attribute.Float64("workflow.persist_ms", float64(time.Since(startedAt).Milliseconds())),
			attribute.String("workflow.result_document_id", result.DocumentID),
			attribute.String("workflow.result_version_id", result.VersionID),
		)
		return result, nil
	},
)

type DocumentWorkflowSet struct {
	Upload         *romancy.WorkflowFunc[DocumentOperationInput, DocumentOperationResult]
	EditResolution *romancy.WorkflowFunc[DocumentOperationInput, DocumentOperationResult]
	Generated      *romancy.WorkflowFunc[DocumentOperationInput, DocumentOperationResult]
}

func RegisterDocumentWorkflows(app *romancy.App, db *persistence.DB, appID, storageRoot string) DocumentWorkflowSet {
	setActiveWorkflowResources(appID, workflowResources{db: db, storageRoot: storageRoot})
	workflows := DocumentWorkflowSet{
		Upload:         documentOperationWorkflow(appID, DocumentUploadWorkflowName),
		EditResolution: documentOperationWorkflow(appID, EditResolutionWorkflowName),
		Generated:      documentOperationWorkflow(appID, GeneratedDocumentWorkflowName),
	}
	romancy.RegisterWorkflow[DocumentOperationInput, DocumentOperationResult](app, workflows.Upload)
	romancy.RegisterWorkflow[DocumentOperationInput, DocumentOperationResult](app, workflows.EditResolution)
	romancy.RegisterWorkflow[DocumentOperationInput, DocumentOperationResult](app, workflows.Generated)
	return workflows
}

func documentOperationWorkflow(appID, workflowName string) *romancy.WorkflowFunc[DocumentOperationInput, DocumentOperationResult] {
	return romancy.DefineWorkflow(
		workflowName,
		func(ctx *romancy.WorkflowContext, input DocumentOperationInput) (DocumentOperationResult, error) {
			input.AppID = appID
			input.WorkflowName = workflowName
			spanCtx, span := workflowsTracer.Start(ctx.Context(), "document.workflow.body")
			span.SetAttributes(
				attribute.String("workflow.name", workflowName),
				attribute.String("workflow.app_id", appID),
				attribute.String("workflow.target_id", input.TargetID),
			)
			slog.InfoContext(spanCtx, "document.workflow.body.enter",
				"workflow_name", workflowName,
				"app_id", appID,
				"target_id", input.TargetID,
				"instance_id", ctx.InstanceID())
			result, err := persistDocumentOperation.Execute(ctx, input, romancy.WithActivityID(persistDocumentOperationActivityID))
			if err != nil {
				slog.ErrorContext(spanCtx, "document.workflow.body.exit_error",
					"workflow_name", workflowName,
					"instance_id", ctx.InstanceID(),
					"error", err.Error())
			} else {
				slog.InfoContext(spanCtx, "document.workflow.body.exit_ok",
					"workflow_name", workflowName,
					"instance_id", ctx.InstanceID())
			}
			span.End()
			return result, err
		},
	)
}

type workflowResources struct {
	db          *persistence.DB
	storageRoot string
}

var workflowResourceRegistry = struct {
	sync.Mutex
	byAppID map[string]workflowResources
}{byAppID: map[string]workflowResources{}}

func setActiveWorkflowResources(appID string, resources workflowResources) {
	workflowResourceRegistry.Lock()
	defer workflowResourceRegistry.Unlock()
	workflowResourceRegistry.byAppID[appID] = resources
}

func clearActiveWorkflowDB(appID string) {
	workflowResourceRegistry.Lock()
	defer workflowResourceRegistry.Unlock()
	delete(workflowResourceRegistry.byAppID, appID)
}

func activeWorkflowDB(appID string) *persistence.DB {
	resources, ok := activeWorkflowResources(appID)
	if !ok {
		return nil
	}
	return resources.db
}

func activeWorkflowResources(appID string) (workflowResources, bool) {
	workflowResourceRegistry.Lock()
	defer workflowResourceRegistry.Unlock()
	resources, ok := workflowResourceRegistry.byAppID[appID]
	if !ok {
		return workflowResources{}, false
	}
	return resources, true
}

var nonRecordID = regexp.MustCompile(`[^A-Za-z0-9_]+`)

func workflowOperationID(workflowName, targetID string) string {
	id := nonRecordID.ReplaceAllString(workflowName+"_"+targetID, "_")
	return "workflow_operations:" + id
}

func surrealString(value string) string {
	return strconv.Quote(value)
}

func persistDocumentWorkflowPayload(ctx context.Context, resources *workflowResources, input DocumentOperationInput, operationID string) (DocumentOperationResult, error) {
	switch input.WorkflowName {
	case DocumentUploadWorkflowName, GeneratedDocumentWorkflowName:
		return persistDocumentVersionWorkflow(ctx, resources, input, operationID)
	case EditResolutionWorkflowName:
		return persistEditResolutionWorkflow(ctx, resources, input, operationID)
	default:
		return DocumentOperationResult{}, fmt.Errorf("unsupported document workflow %q", input.WorkflowName)
	}
}

// PersistDocumentOperation runs the document-upload / edit-resolution
// persistence body directly against the App's DB and storage root, bypassing
// romancy entirely. Replaces the StartWorkflow + poll pattern that used to
// hold the SQLite writer lock and time out on busy chats; see
// /Users/luca/.claude/plans/yeah-sounds-more-reasonable-shimmering-sunrise.md.
//
// The romancy-wrapped activity (persistDocumentOperation) now delegates to
// this same function — both paths share the body so behavior is identical.
func PersistDocumentOperation(ctx context.Context, app *App, input DocumentOperationInput) (DocumentOperationResult, error) {
	if app == nil {
		return DocumentOperationResult{}, fmt.Errorf("app is required")
	}
	resources := workflowResources{db: app.DB, storageRoot: app.LocalStorageRoot}
	input = input.withDefaults(ctx)
	if input.AppID == "" {
		input.AppID = app.DataDir
	}
	if input.WorkflowName == "" {
		return DocumentOperationResult{}, fmt.Errorf("workflow_name is required")
	}
	if input.TargetID == "" {
		return DocumentOperationResult{}, fmt.Errorf("target_id is required")
	}
	operationID := workflowOperationID(input.WorkflowName, input.TargetID)
	result, err := persistDocumentWorkflowPayload(ctx, &resources, input, operationID)
	if err != nil {
		return DocumentOperationResult{}, err
	}
	result.OperationID = operationID
	result.UserID = input.User.UserID
	return result, nil
}

func persistDocumentVersionWorkflow(ctx context.Context, resources *workflowResources, input DocumentOperationInput, operationID string) (DocumentOperationResult, error) {
	documentID := payloadString(input.Payload, "document_id", input.TargetID)
	versionID := payloadString(input.Payload, "version_id", documentID+"_v1")
	filename := payloadString(input.Payload, "filename", documentID)
	fileType := payloadString(input.Payload, "file_type", "")
	storagePath := payloadString(input.Payload, "storage_path", documentID+"/"+filename)
	source := "upload"
	if input.WorkflowName == GeneratedDocumentWorkflowName {
		source = "generated"
	}
	content, err := payloadBytes(input.Payload)
	if err != nil {
		return DocumentOperationResult{}, err
	}
	if content != nil {
		if writeErr := WriteLocalFileAtomic(resources.storageRoot, storagePath, content); writeErr != nil {
			return DocumentOperationResult{}, writeErr
		}
	}
	// Build the plain-text twin synchronously so the version row already
	// carries the text by the time the upload returns. PDF + DOCX produce
	// new text; .md/.txt/.csv/.json round-trip raw bytes for uniform
	// consumption; anything else gets stored as a "skipped" status.
	var extract textextract.Result
	if content != nil {
		extract = textextract.Extract(ctx, filename, content)
	} else {
		extract = textextract.Result{Status: textextract.StatusSkipped, Reason: "no_content"}
	}
	payloadJSON, err := json.Marshal(input.Payload)
	if err != nil {
		return DocumentOperationResult{}, err
	}
	size := len(content)
	if explicitSize, ok := payloadNumber(input.Payload, "size_bytes"); ok {
		size = explicitSize
	}
	versionNumber := 1
	if explicitVersion, ok := payloadNumber(input.Payload, "version_number"); ok {
		versionNumber = explicitVersion
	}
	err = resources.db.Transaction(ctx, func(ctx context.Context, tx *persistence.Tx) error {
		if txErr := txQuery(ctx, tx, "upsert_document", fmt.Sprintf(`
			UPSERT %s CONTENT {
				user_id: users:local,
				application_id: NONE,
				filename: %s,
				file_type: %s,
				size_bytes: %d,
				page_count: NONE,
				structure_tree: { root: [] },
				status: "ready",
				folder_id: NONE,
				current_version_id: %s,
				created_at: time::now(),
				updated_at: time::now()
			};
		`, recordID("documents", documentID), surrealString(filename), optionString(fileType), size, recordID("document_versions", versionID))); txErr != nil {
			return txErr
		}
		if txErr := txQuery(ctx, tx, "upsert_document_version", fmt.Sprintf(`
			UPSERT %s CONTENT {
				document_id: %s,
				storage_path: %s,
				pdf_storage_path: NONE,
				source: %s,
				version_number: %d,
				display_name: %s,
				extracted_text: %s,
				extracted_text_chars: %s,
				extraction_status: %s,
				extraction_error: %s,
				created_at: time::now()
			};
		`,
			recordID("document_versions", versionID),
			recordID("documents", documentID),
			surrealString(storagePath),
			surrealString(source),
			versionNumber,
			surrealString(filename),
			optionString(extract.Text),
			optionInt(len(extract.Text), extract.Text != ""),
			optionString(string(extract.Status)),
			optionString(extract.Error),
		)); txErr != nil {
			return txErr
		}
		return upsertWorkflowOperation(ctx, tx, operationID, input, payloadJSON)
	})
	if err != nil {
		return DocumentOperationResult{}, err
	}
	return DocumentOperationResult{DocumentID: recordID("documents", documentID), VersionID: recordID("document_versions", versionID)}, nil
}

func persistEditResolutionWorkflow(ctx context.Context, resources *workflowResources, input DocumentOperationInput, operationID string) (DocumentOperationResult, error) {
	documentID := payloadString(input.Payload, "document_id", input.TargetID)
	versionID := payloadString(input.Payload, "version_id", documentID+"_resolved")
	editID := payloadString(input.Payload, "edit_id", documentID+"_edit")
	status := payloadString(input.Payload, "status", "accepted")
	if status != "accepted" && status != "rejected" {
		return DocumentOperationResult{}, fmt.Errorf("edit resolution status must be accepted or rejected")
	}
	source := "user_accept"
	if status == "rejected" {
		source = "user_reject"
	}
	filename := payloadString(input.Payload, "filename", documentID)
	storagePath := payloadString(input.Payload, "storage_path", documentID+"/"+filename)
	content, err := payloadBytes(input.Payload)
	if err != nil {
		return DocumentOperationResult{}, err
	}
	if content != nil {
		if writeErr := WriteLocalFileAtomic(resources.storageRoot, storagePath, content); writeErr != nil {
			return DocumentOperationResult{}, writeErr
		}
	}
	payloadJSON, err := json.Marshal(input.Payload)
	if err != nil {
		return DocumentOperationResult{}, err
	}
	versionNumber := 1
	if explicitVersion, ok := payloadNumber(input.Payload, "version_number"); ok {
		versionNumber = explicitVersion
	}
	err = resources.db.Transaction(ctx, func(ctx context.Context, tx *persistence.Tx) error {
		if _, queryErr := tx.Query(ctx, fmt.Sprintf(`
			UPSERT %s CONTENT {
				document_id: %s,
				storage_path: %s,
				pdf_storage_path: NONE,
				source: %s,
				version_number: %d,
				display_name: %s,
				created_at: time::now()
			};
		`, recordID("document_versions", versionID), recordID("documents", documentID), surrealString(storagePath), surrealString(source), versionNumber, surrealString(filename))); queryErr != nil {
			return queryErr
		}
		if _, queryErr := tx.Query(ctx, fmt.Sprintf(`
			UPSERT %s CONTENT {
				document_id: %s,
				chat_message_id: NONE,
				version_id: %s,
				change_id: %s,
				del_w_id: NONE,
				ins_w_id: NONE,
				deleted_text: %s,
				inserted_text: %s,
				context_before: NONE,
				context_after: NONE,
				status: %s,
				created_at: time::now(),
				resolved_at: time::now()
			};
		`, recordID("document_edits", editID), recordID("documents", documentID), recordID("document_versions", versionID), surrealString(payloadString(input.Payload, "change_id", editID)), surrealString(payloadString(input.Payload, "deleted_text", "")), surrealString(payloadString(input.Payload, "inserted_text", "")), surrealString(status))); queryErr != nil {
			return queryErr
		}
		if _, queryErr := tx.Query(ctx, fmt.Sprintf(`UPDATE %s SET current_version_id = %s, updated_at = time::now();`, recordID("documents", documentID), recordID("document_versions", versionID))); queryErr != nil {
			return queryErr
		}
		return upsertWorkflowOperation(ctx, tx, operationID, input, payloadJSON)
	})
	if err != nil {
		return DocumentOperationResult{}, err
	}
	return DocumentOperationResult{DocumentID: recordID("documents", documentID), VersionID: recordID("document_versions", versionID), EditID: recordID("document_edits", editID)}, nil
}

func upsertWorkflowOperation(ctx context.Context, tx *persistence.Tx, operationID string, input DocumentOperationInput, payloadJSON []byte) error {
	_, err := tx.Query(ctx, fmt.Sprintf(`
		UPSERT %s CONTENT {
			workflow_name: %s,
			user_id: users:local,
			target_id: %s,
			payload: %s,
			created_at: time::now(),
			updated_at: time::now()
		};
	`, operationID, surrealString(input.WorkflowName), surrealString(input.TargetID), string(payloadJSON)))
	return err
}

func payloadString(payload map[string]any, key, fallback string) string {
	value, ok := payload[key].(string)
	if !ok || value == "" {
		return fallback
	}
	return value
}

func payloadNumber(payload map[string]any, key string) (int, bool) {
	switch value := payload[key].(type) {
	case float64:
		return int(value), true
	case int:
		return value, true
	case int64:
		return int(value), true
	case json.Number:
		parsed, err := value.Int64()
		if err != nil {
			return 0, false
		}
		return int(parsed), true
	default:
		return 0, false
	}
}

func payloadBytes(payload map[string]any) ([]byte, error) {
	if value, ok := payload["content_base64"].(string); ok && value != "" {
		return base64.StdEncoding.DecodeString(value)
	}
	if value, ok := payload["content"].(string); ok {
		return []byte(value), nil
	}
	return nil, nil
}

func optionString(value string) string {
	if value == "" {
		return "NONE"
	}
	return surrealString(value)
}
