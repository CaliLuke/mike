package localdata

import (
	"context"
	"fmt"

	"github.com/CaliLuke/luke/backend-go/internal/persistence"
)

func initSchema(ctx context.Context, db *persistence.DB) error {
	if _, err := db.Query(ctx, schemaSurrealQL); err != nil {
		return fmt.Errorf("initialize local SurrealDB schema: %w", err)
	}
	return nil
}

func seedLocalUser(ctx context.Context, db *persistence.DB) error {
	if _, err := db.Query(ctx, seedLocalUserSurrealQL); err != nil {
		return fmt.Errorf("seed deterministic local user: %w", err)
	}
	return nil
}

const schemaSurrealQL = `
DEFINE TABLE IF NOT EXISTS users SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS email ON TABLE users TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE users TYPE datetime;
DEFINE INDEX IF NOT EXISTS users_email_idx ON TABLE users FIELDS email UNIQUE;

DEFINE TABLE IF NOT EXISTS user_profiles SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE user_profiles TYPE record<users>;
DEFINE FIELD IF NOT EXISTS display_name ON TABLE user_profiles TYPE option<string>;
DEFINE FIELD IF NOT EXISTS organisation ON TABLE user_profiles TYPE option<string>;
DEFINE FIELD IF NOT EXISTS tier ON TABLE user_profiles TYPE string ASSERT $value INSIDE ["Local"];
DEFINE FIELD IF NOT EXISTS message_credits_used ON TABLE user_profiles TYPE int ASSERT $value >= 0;
DEFINE FIELD IF NOT EXISTS credits_reset_date ON TABLE user_profiles TYPE datetime;
DEFINE FIELD IF NOT EXISTS tabular_model ON TABLE user_profiles TYPE string;
DEFINE FIELD IF NOT EXISTS claude_api_key ON TABLE user_profiles TYPE option<string>;
DEFINE FIELD IF NOT EXISTS gemini_api_key ON TABLE user_profiles TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE user_profiles TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE user_profiles TYPE datetime;
DEFINE INDEX IF NOT EXISTS user_profiles_user_idx ON TABLE user_profiles FIELDS user_id UNIQUE;

DEFINE TABLE IF NOT EXISTS projects SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE projects TYPE record<users>;
DEFINE FIELD IF NOT EXISTS name ON TABLE projects TYPE string;
DEFINE FIELD IF NOT EXISTS cm_number ON TABLE projects TYPE option<string>;
DEFINE FIELD IF NOT EXISTS visibility ON TABLE projects TYPE string ASSERT $value INSIDE ["private", "shared"];
DEFINE FIELD IF NOT EXISTS shared_with ON TABLE projects TYPE array<string>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE projects TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE projects TYPE datetime;
DEFINE INDEX IF NOT EXISTS projects_user_idx ON TABLE projects FIELDS user_id;

DEFINE TABLE IF NOT EXISTS project_folders SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS project_id ON TABLE project_folders TYPE record<projects>;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE project_folders TYPE record<users>;
DEFINE FIELD IF NOT EXISTS name ON TABLE project_folders TYPE string;
DEFINE FIELD IF NOT EXISTS parent_folder_id ON TABLE project_folders TYPE option<record<project_folders>>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE project_folders TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE project_folders TYPE datetime;
DEFINE INDEX IF NOT EXISTS project_folders_project_idx ON TABLE project_folders FIELDS project_id;

DEFINE TABLE IF NOT EXISTS documents SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS project_id ON TABLE documents TYPE option<record<projects>>;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE documents TYPE record<users>;
DEFINE FIELD IF NOT EXISTS filename ON TABLE documents TYPE string;
DEFINE FIELD IF NOT EXISTS file_type ON TABLE documents TYPE option<string>;
DEFINE FIELD IF NOT EXISTS size_bytes ON TABLE documents TYPE int ASSERT $value >= 0;
DEFINE FIELD IF NOT EXISTS page_count ON TABLE documents TYPE option<int>;
DEFINE FIELD IF NOT EXISTS structure_tree ON TABLE documents TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS status ON TABLE documents TYPE string ASSERT $value INSIDE ["pending", "processing", "ready", "error"];
DEFINE FIELD IF NOT EXISTS folder_id ON TABLE documents TYPE option<record<project_folders>>;
DEFINE FIELD IF NOT EXISTS current_version_id ON TABLE documents TYPE option<record<document_versions>>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE documents TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE documents TYPE datetime;
DEFINE INDEX IF NOT EXISTS documents_project_folder_idx ON TABLE documents FIELDS project_id, folder_id;

DEFINE TABLE IF NOT EXISTS document_versions SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS document_id ON TABLE document_versions TYPE record<documents>;
DEFINE FIELD IF NOT EXISTS storage_path ON TABLE document_versions TYPE string;
DEFINE FIELD IF NOT EXISTS pdf_storage_path ON TABLE document_versions TYPE option<string>;
DEFINE FIELD IF NOT EXISTS source ON TABLE document_versions TYPE string ASSERT $value INSIDE ["upload", "user_upload", "assistant_edit", "user_accept", "user_reject", "generated"];
DEFINE FIELD IF NOT EXISTS version_number ON TABLE document_versions TYPE option<int>;
DEFINE FIELD IF NOT EXISTS display_name ON TABLE document_versions TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE document_versions TYPE datetime;
DEFINE INDEX IF NOT EXISTS document_versions_doc_created_idx ON TABLE document_versions FIELDS document_id, created_at;
DEFINE INDEX IF NOT EXISTS document_versions_doc_vnum_idx ON TABLE document_versions FIELDS document_id, version_number UNIQUE;

DEFINE TABLE IF NOT EXISTS document_edits SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS document_id ON TABLE document_edits TYPE record<documents>;
DEFINE FIELD IF NOT EXISTS chat_message_id ON TABLE document_edits TYPE option<record<chat_messages>>;
DEFINE FIELD IF NOT EXISTS version_id ON TABLE document_edits TYPE record<document_versions>;
DEFINE FIELD IF NOT EXISTS change_id ON TABLE document_edits TYPE string;
DEFINE FIELD IF NOT EXISTS del_w_id ON TABLE document_edits TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ins_w_id ON TABLE document_edits TYPE option<string>;
DEFINE FIELD IF NOT EXISTS deleted_text ON TABLE document_edits TYPE string;
DEFINE FIELD IF NOT EXISTS inserted_text ON TABLE document_edits TYPE string;
DEFINE FIELD IF NOT EXISTS context_before ON TABLE document_edits TYPE option<string>;
DEFINE FIELD IF NOT EXISTS context_after ON TABLE document_edits TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status ON TABLE document_edits TYPE string ASSERT $value INSIDE ["pending", "accepted", "rejected"];
DEFINE FIELD IF NOT EXISTS created_at ON TABLE document_edits TYPE datetime;
DEFINE FIELD IF NOT EXISTS resolved_at ON TABLE document_edits TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS document_edits_document_idx ON TABLE document_edits FIELDS document_id, created_at;
DEFINE INDEX IF NOT EXISTS document_edits_message_idx ON TABLE document_edits FIELDS chat_message_id;
DEFINE INDEX IF NOT EXISTS document_edits_version_idx ON TABLE document_edits FIELDS version_id;

DEFINE TABLE IF NOT EXISTS workflows SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE workflows TYPE option<record<users>>;
DEFINE FIELD IF NOT EXISTS title ON TABLE workflows TYPE string;
DEFINE FIELD IF NOT EXISTS type ON TABLE workflows TYPE option<string>;
DEFINE FIELD IF NOT EXISTS prompt_md ON TABLE workflows TYPE option<string>;
DEFINE FIELD IF NOT EXISTS columns_config ON TABLE workflows TYPE any;
DEFINE FIELD IF NOT EXISTS practice ON TABLE workflows TYPE option<string>;
DEFINE FIELD IF NOT EXISTS is_system ON TABLE workflows TYPE bool;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE workflows TYPE datetime;
DEFINE INDEX IF NOT EXISTS workflows_user_idx ON TABLE workflows FIELDS user_id;

DEFINE TABLE IF NOT EXISTS hidden_workflows SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE hidden_workflows TYPE record<users>;
DEFINE FIELD IF NOT EXISTS workflow_id ON TABLE hidden_workflows TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE hidden_workflows TYPE datetime;
DEFINE INDEX IF NOT EXISTS hidden_workflows_user_idx ON TABLE hidden_workflows FIELDS user_id;
DEFINE INDEX IF NOT EXISTS hidden_workflows_user_workflow_idx ON TABLE hidden_workflows FIELDS user_id, workflow_id UNIQUE;

DEFINE TABLE IF NOT EXISTS workflow_shares SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS workflow_id ON TABLE workflow_shares TYPE record<workflows>;
DEFINE FIELD IF NOT EXISTS shared_by_user_id ON TABLE workflow_shares TYPE record<users>;
DEFINE FIELD IF NOT EXISTS shared_with_email ON TABLE workflow_shares TYPE string;
DEFINE FIELD IF NOT EXISTS allow_edit ON TABLE workflow_shares TYPE bool;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE workflow_shares TYPE datetime;
DEFINE INDEX IF NOT EXISTS workflow_shares_workflow_idx ON TABLE workflow_shares FIELDS workflow_id;
DEFINE INDEX IF NOT EXISTS workflow_shares_email_idx ON TABLE workflow_shares FIELDS shared_with_email;
DEFINE INDEX IF NOT EXISTS workflow_shares_workflow_email_idx ON TABLE workflow_shares FIELDS workflow_id, shared_with_email UNIQUE;

DEFINE TABLE IF NOT EXISTS chats SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS project_id ON TABLE chats TYPE option<record<projects>>;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE chats TYPE record<users>;
DEFINE FIELD IF NOT EXISTS title ON TABLE chats TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE chats TYPE datetime;
DEFINE INDEX IF NOT EXISTS chats_user_idx ON TABLE chats FIELDS user_id;
DEFINE INDEX IF NOT EXISTS chats_project_idx ON TABLE chats FIELDS project_id;

DEFINE TABLE IF NOT EXISTS chat_messages SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS chat_id ON TABLE chat_messages TYPE record<chats>;
DEFINE FIELD IF NOT EXISTS role ON TABLE chat_messages TYPE string ASSERT $value INSIDE ["user", "assistant", "system", "tool"];
DEFINE FIELD IF NOT EXISTS content ON TABLE chat_messages TYPE any;
DEFINE FIELD IF NOT EXISTS files ON TABLE chat_messages TYPE any;
DEFINE FIELD IF NOT EXISTS annotations ON TABLE chat_messages TYPE any;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE chat_messages TYPE datetime;
DEFINE INDEX IF NOT EXISTS chat_messages_chat_idx ON TABLE chat_messages FIELDS chat_id, created_at;

DEFINE TABLE IF NOT EXISTS tabular_reviews SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS project_id ON TABLE tabular_reviews TYPE option<record<projects>>;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE tabular_reviews TYPE record<users>;
DEFINE FIELD IF NOT EXISTS title ON TABLE tabular_reviews TYPE option<string>;
DEFINE FIELD IF NOT EXISTS columns_config ON TABLE tabular_reviews TYPE any;
DEFINE FIELD IF NOT EXISTS workflow_id ON TABLE tabular_reviews TYPE option<record<workflows>>;
DEFINE FIELD IF NOT EXISTS practice ON TABLE tabular_reviews TYPE option<string>;
DEFINE FIELD IF NOT EXISTS shared_with ON TABLE tabular_reviews TYPE array<string>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE tabular_reviews TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE tabular_reviews TYPE datetime;
DEFINE INDEX IF NOT EXISTS tabular_reviews_user_idx ON TABLE tabular_reviews FIELDS user_id;
DEFINE INDEX IF NOT EXISTS tabular_reviews_project_idx ON TABLE tabular_reviews FIELDS project_id;

DEFINE TABLE IF NOT EXISTS tabular_cells SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS review_id ON TABLE tabular_cells TYPE record<tabular_reviews>;
DEFINE FIELD IF NOT EXISTS document_id ON TABLE tabular_cells TYPE record<documents>;
DEFINE FIELD IF NOT EXISTS column_index ON TABLE tabular_cells TYPE int ASSERT $value >= 0;
DEFINE FIELD IF NOT EXISTS content ON TABLE tabular_cells TYPE option<string>;
DEFINE FIELD IF NOT EXISTS citations ON TABLE tabular_cells TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS status ON TABLE tabular_cells TYPE string ASSERT $value INSIDE ["pending", "generating", "done", "error"];
DEFINE FIELD IF NOT EXISTS created_at ON TABLE tabular_cells TYPE datetime;
DEFINE INDEX IF NOT EXISTS tabular_cells_review_doc_column_idx ON TABLE tabular_cells FIELDS review_id, document_id, column_index UNIQUE;

DEFINE TABLE IF NOT EXISTS tabular_review_chats SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS review_id ON TABLE tabular_review_chats TYPE record<tabular_reviews>;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE tabular_review_chats TYPE record<users>;
DEFINE FIELD IF NOT EXISTS title ON TABLE tabular_review_chats TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE tabular_review_chats TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE tabular_review_chats TYPE datetime;
DEFINE INDEX IF NOT EXISTS tabular_review_chats_review_idx ON TABLE tabular_review_chats FIELDS review_id, updated_at;
DEFINE INDEX IF NOT EXISTS tabular_review_chats_user_idx ON TABLE tabular_review_chats FIELDS user_id;

DEFINE TABLE IF NOT EXISTS tabular_review_chat_messages SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS chat_id ON TABLE tabular_review_chat_messages TYPE record<tabular_review_chats>;
DEFINE FIELD IF NOT EXISTS role ON TABLE tabular_review_chat_messages TYPE string ASSERT $value INSIDE ["user", "assistant", "system", "tool"];
DEFINE FIELD IF NOT EXISTS content ON TABLE tabular_review_chat_messages TYPE any;
DEFINE FIELD IF NOT EXISTS annotations ON TABLE tabular_review_chat_messages TYPE any;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE tabular_review_chat_messages TYPE datetime;
DEFINE INDEX IF NOT EXISTS tabular_review_chat_messages_chat_idx ON TABLE tabular_review_chat_messages FIELDS chat_id, created_at;

DEFINE TABLE IF NOT EXISTS download_tokens SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS user_id ON TABLE download_tokens TYPE record<users>;
DEFINE FIELD IF NOT EXISTS token ON TABLE download_tokens TYPE string;
DEFINE FIELD IF NOT EXISTS payload ON TABLE download_tokens TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS expires_at ON TABLE download_tokens TYPE datetime;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE download_tokens TYPE datetime;
DEFINE INDEX IF NOT EXISTS download_tokens_token_idx ON TABLE download_tokens FIELDS token UNIQUE;

DEFINE TABLE IF NOT EXISTS workflow_operations SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS workflow_name ON TABLE workflow_operations TYPE string ASSERT $value INSIDE ["document_upload", "edit_resolution", "generated_document_persistence"];
DEFINE FIELD IF NOT EXISTS user_id ON TABLE workflow_operations TYPE record<users>;
DEFINE FIELD IF NOT EXISTS target_id ON TABLE workflow_operations TYPE string;
DEFINE FIELD IF NOT EXISTS payload ON TABLE workflow_operations TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE workflow_operations TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE workflow_operations TYPE datetime;
DEFINE INDEX IF NOT EXISTS workflow_operations_target_idx ON TABLE workflow_operations FIELDS workflow_name, target_id UNIQUE;

DEFINE EVENT IF NOT EXISTS cascade_project_delete ON TABLE projects WHEN $event = "DELETE" THEN {
	DELETE document_versions WHERE document_id IN (SELECT VALUE id FROM documents WHERE project_id = $before.id);
	DELETE document_edits WHERE document_id IN (SELECT VALUE id FROM documents WHERE project_id = $before.id);
	DELETE tabular_cells WHERE document_id IN (SELECT VALUE id FROM documents WHERE project_id = $before.id);
	DELETE chat_messages WHERE chat_id IN (SELECT VALUE id FROM chats WHERE project_id = $before.id);
	DELETE tabular_review_chat_messages WHERE chat_id IN (SELECT VALUE id FROM tabular_review_chats WHERE review_id IN (SELECT VALUE id FROM tabular_reviews WHERE project_id = $before.id));
	DELETE tabular_review_chats WHERE review_id IN (SELECT VALUE id FROM tabular_reviews WHERE project_id = $before.id);
	DELETE project_folders WHERE project_id = $before.id;
	DELETE documents WHERE project_id = $before.id;
	DELETE chats WHERE project_id = $before.id;
	DELETE tabular_reviews WHERE project_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_project_folder_delete ON TABLE project_folders WHEN $event = "DELETE" THEN {
	DELETE project_folders WHERE parent_folder_id = $before.id;
	UPDATE documents SET folder_id = NONE WHERE folder_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_document_delete ON TABLE documents WHEN $event = "DELETE" THEN {
	DELETE document_versions WHERE document_id = $before.id;
	DELETE document_edits WHERE document_id = $before.id;
	DELETE tabular_cells WHERE document_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_document_version_delete ON TABLE document_versions WHEN $event = "DELETE" THEN {
	DELETE document_edits WHERE version_id = $before.id;
	UPDATE documents SET current_version_id = NONE WHERE current_version_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_chat_delete ON TABLE chats WHEN $event = "DELETE" THEN {
	DELETE chat_messages WHERE chat_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_chat_message_delete ON TABLE chat_messages WHEN $event = "DELETE" THEN {
	UPDATE document_edits SET chat_message_id = NONE WHERE chat_message_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_workflow_delete ON TABLE workflows WHEN $event = "DELETE" THEN {
	DELETE workflow_shares WHERE workflow_id = $before.id;
	UPDATE tabular_reviews SET workflow_id = NONE WHERE workflow_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_tabular_review_delete ON TABLE tabular_reviews WHEN $event = "DELETE" THEN {
	DELETE tabular_cells WHERE review_id = $before.id;
	DELETE tabular_review_chat_messages WHERE chat_id IN (SELECT VALUE id FROM tabular_review_chats WHERE review_id = $before.id);
	DELETE tabular_review_chats WHERE review_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_tabular_review_chat_delete ON TABLE tabular_review_chats WHEN $event = "DELETE" THEN {
	DELETE tabular_review_chat_messages WHERE chat_id = $before.id;
};

DEFINE EVENT IF NOT EXISTS cascade_workflow_operation_delete ON TABLE workflow_operations WHEN $event = "DELETE" THEN {
	DELETE download_tokens WHERE payload.workflow_operation_id = $before.id;
};
`

const seedLocalUserSurrealQL = `
UPSERT users:local CONTENT {
	email: "local@luke.local",
	created_at: time::now()
};
UPSERT user_profiles:local CONTENT {
	user_id: users:local,
	display_name: "Local User",
	organisation: NONE,
	tier: "Local",
	message_credits_used: 0,
	credits_reset_date: d"9999-12-31T23:59:59Z",
	tabular_model: "gemma4",
	claude_api_key: NONE,
	gemini_api_key: NONE,
	created_at: time::now(),
	updated_at: time::now()
};
`
