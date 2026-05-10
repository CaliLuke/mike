package design

import . "github.com/CaliLuke/loom/dsl"

var AssistantNoArgs = Type("AssistantNoArgs", func() {
	Example(map[string]any{})
})

var AssistantDocumentRef = Type("AssistantDocumentRef", func() {
	Attribute("document_id", String, "Local document identifier")
	Attribute("filename", String, "Document filename")
	Attribute("application_id", String, "Owning application identifier, when attached to a application")
	Attribute("file_type", String, "Stored file type or MIME hint")
	Attribute("status", String, "Processing status")
})

var AssistantDocumentList = Type("AssistantDocumentList", func() {
	Attribute("documents", ArrayOf(AssistantDocumentRef), "Documents available to the current chat")
})

var AssistantReadDocumentArgs = Type("AssistantReadDocumentArgs", func() {
	Attribute("document_id", String, "Local document identifier to read")
	Example(map[string]any{"document_id": "doc_123"})
})

var AssistantDocumentText = Type("AssistantDocumentText", func() {
	Attribute("document_id", String, "Local document identifier")
	Attribute("filename", String, "Document filename")
	Attribute("text", String, "Plain text extracted from the current document version")
})

var AssistantFindDocumentArgs = Type("AssistantFindDocumentArgs", func() {
	Attribute("document_id", String, "Local document identifier to search")
	Attribute("query", String, "Exact text to find")
	Attribute("max_results", Int, "Maximum number of matches to return")
	Attribute("context_chars", Int, "Characters of context to include around each match")
	Example(map[string]any{"document_id": "doc_123", "query": "React", "max_results": 5, "context_chars": 120})
})

var AssistantDocumentMatch = Type("AssistantDocumentMatch", func() {
	Attribute("index", Int, "Zero-based match index")
	Attribute("start", Int, "Start character offset")
	Attribute("end", Int, "End character offset")
	Attribute("quote", String, "Matched text")
	Attribute("context", String, "Surrounding text context")
})

var AssistantDocumentMatches = Type("AssistantDocumentMatches", func() {
	Attribute("document_id", String, "Local document identifier")
	Attribute("filename", String, "Document filename")
	Attribute("matches", ArrayOf(AssistantDocumentMatch), "Search matches")
	Attribute("total_matches", Int, "Total matches found before truncation")
})

var AssistantFetchDocumentsArgs = Type("AssistantFetchDocumentsArgs", func() {
	Attribute("document_ids", ArrayOf(String), "Local document identifiers to fetch")
	Example(map[string]any{"document_ids": []string{"doc_123", "doc_456"}})
})

var AssistantDocumentBundle = Type("AssistantDocumentBundle", func() {
	Attribute("documents", ArrayOf(AssistantDocumentText), "Fetched document contents")
})

var AssistantFetchWebPageArgs = Type("AssistantFetchWebPageArgs", func() {
	Attribute("url", String, "Public HTTP or HTTPS URL to download and simplify")
	Attribute("max_chars", Int, "Optional maximum characters of simplified text to return")
	Example(map[string]any{"url": "https://www.github.careers/careers-home/jobs/5140?lang=en-us", "max_chars": 40000})
})

var AssistantWebPageText = Type("AssistantWebPageText", func() {
	Attribute("url", String, "Final fetched URL after redirects")
	Attribute("title", String, "Extracted page title")
	Attribute("text", String, "Simplified readable page text")
	Attribute("truncated", Boolean, "Whether the simplified text was truncated")
	Attribute("error", String, "Error message when fetching failed")
})

var AssistantWorkflowRef = Type("AssistantWorkflowRef", func() {
	Attribute("workflow_id", String, "Local workflow identifier")
	Attribute("title", String, "Workflow title")
	Attribute("type", String, "Workflow type")
	Attribute("practice", String, "Workflow practice or category")
})

var AssistantWorkflowList = Type("AssistantWorkflowList", func() {
	Attribute("workflows", ArrayOf(AssistantWorkflowRef), "Saved workflows")
})

var AssistantCreateCompanyArgs = Type("AssistantCreateCompanyArgs", func() {
	Attribute("name", String, "Company name")
	Attribute("website", String, "Optional company website")
	Attribute("confirm_new", Boolean, "Set true only after reviewing a similar existing company and deciding a separate company should be created")
	Example(map[string]any{"name": "Acme Inc.", "website": "https://example.com"})
})

var AssistantCreatedCompany = Type("AssistantCreatedCompany", func() {
	Attribute("ok", Boolean, "Whether the company was created")
	Attribute("company_id", String, "Local company identifier")
	Attribute("name", String, "Company name")
	Attribute("website", String, "Company website")
	Attribute("reused_existing", Boolean, "Whether an existing company was reused instead of creating a duplicate")
	Attribute("requires_confirmation", Boolean, "Whether a similar existing company blocked creation until confirm_new is true")
	Attribute("similar_company_id", String, "Similar existing company identifier, when one was found")
	Attribute("similar_company_name", String, "Similar existing company name, when one was found")
	Attribute("similarity", Float64, "Similarity score for the nearest existing company, from 0 to 1")
	Attribute("error", String, "Error message when creation failed")
})

var AssistantCreateApplicationArgs = Type("AssistantCreateApplicationArgs", func() {
	Attribute("name", String, "Application name, usually the role title from the job ad")
	Attribute("company_id", String, "Local company identifier returned by create_company or a prior company_created event")
	Attribute("cm_number", String, "Optional Competition Bureau matter number")
	Attribute("job_description_text", String, "Optional full job description text to save as an application document")
	Attribute("job_description_url", String, "Optional source URL for the job description")
	Example(map[string]any{"name": "Senior Product Counsel", "company_id": "company_123", "job_description_url": "https://example.com/jobs/123"})
})

var AssistantCreatedApplication = Type("AssistantCreatedApplication", func() {
	Attribute("ok", Boolean, "Whether the application was created")
	Attribute("application_id", String, "Local application identifier")
	Attribute("company_id", String, "Attached local company identifier")
	Attribute("name", String, "Application name")
	Attribute("cm_number", String, "Competition Bureau matter number")
	Attribute("job_description_document_id", String, "Created job description document identifier, when job text was provided")
	Attribute("error", String, "Error message when creation failed")
})

var AssistantReadWorkflowArgs = Type("AssistantReadWorkflowArgs", func() {
	Attribute("workflow_id", String, "Local workflow identifier to read")
	Example(map[string]any{"workflow_id": "workflow_123"})
})

var AssistantWorkflowText = Type("AssistantWorkflowText", func() {
	Attribute("workflow_id", String, "Local workflow identifier")
	Attribute("title", String, "Workflow title")
	Attribute("type", String, "Workflow type")
	Attribute("prompt_md", String, "Workflow prompt")
	Attribute("columns_config", ArrayOf(Any), "Workflow column configuration")
	Attribute("practice", String, "Workflow practice or category")
})

var AssistantDocxTable = Type("AssistantDocxTable", func() {
	Attribute("headers", ArrayOf(String), "Table header cells")
	Attribute("rows", ArrayOf(ArrayOf(String)), "Table body rows")
})

var AssistantDocxSection = Type("AssistantDocxSection", func() {
	Attribute("heading", String, "Optional section heading")
	Attribute("level", Int, "Heading level: 1, 2, or 3")
	Attribute("content", String, "Section prose; blank lines split paragraphs")
	Attribute("pageBreak", Boolean, "Whether to start this section on a new page")
	Attribute("table", AssistantDocxTable, "Optional table for this section")
})

var AssistantGenerateDocxArgs = Type("AssistantGenerateDocxArgs", func() {
	Attribute("title", String, "Document title")
	Attribute("landscape", Boolean, "Whether to use landscape orientation")
	Attribute("sections", ArrayOf(AssistantDocxSection), "Document sections")
	Example(map[string]any{
		"title":     "Tailored Resume Notes",
		"landscape": false,
		"sections":  []any{map[string]any{"heading": "Summary", "level": 1, "content": "Draft content."}},
	})
})

var AssistantGeneratedDocument = Type("AssistantGeneratedDocument", func() {
	Attribute("ok", Boolean, "Whether the document was generated")
	Attribute("filename", String, "Generated filename")
	Attribute("download_url", String, "Local download URL")
	Attribute("document_id", String, "Local document identifier")
	Attribute("version_id", String, "Current document version identifier")
	Attribute("version_number", Int, "Current version number")
	Attribute("error", String, "Error message when generation failed")
})

var AssistantDocumentEdit = Type("AssistantDocumentEdit", func() {
	Attribute("find", String, "Exact text to replace")
	Attribute("replace", String, "Replacement text")
	Attribute("context_before", String, "Optional expected text before the match")
	Attribute("context_after", String, "Optional expected text after the match")
	Attribute("reason", String, "Reason for the change")
})

var AssistantEditDocumentArgs = Type("AssistantEditDocumentArgs", func() {
	Attribute("document_id", String, "Local document identifier to edit")
	Attribute("edits", ArrayOf(AssistantDocumentEdit), "Text replacement edits")
	Example(map[string]any{
		"document_id": "doc_123",
		"edits":       []any{map[string]any{"find": "old", "replace": "new", "reason": "Update wording"}},
	})
})

var AssistantEditAnnotation = Type("AssistantEditAnnotation", func() {
	Attribute("kind", String, "Annotation kind")
	Attribute("edit_id", String, "Edit identifier")
	Attribute("document_id", String, "Local document identifier")
	Attribute("version_id", String, "Document version identifier")
	Attribute("version_number", Int, "Document version number")
	Attribute("change_id", String, "Change identifier")
	Attribute("deleted_text", String, "Text removed")
	Attribute("inserted_text", String, "Text inserted")
	Attribute("context_before", String, "Text before the edit")
	Attribute("context_after", String, "Text after the edit")
	Attribute("reason", String, "Reason for the change")
	Attribute("status", String, "Edit status")
})

var AssistantEditedDocument = Type("AssistantEditedDocument", func() {
	Attribute("ok", Boolean, "Whether edits were applied")
	Attribute("filename", String, "Document filename")
	Attribute("download_url", String, "Local download URL")
	Attribute("document_id", String, "Local document identifier")
	Attribute("version_id", String, "New document version identifier")
	Attribute("version_number", Int, "New version number")
	Attribute("annotations", ArrayOf(AssistantEditAnnotation), "Edit annotations")
	Attribute("error", String, "Error message when editing failed")
})

var AssistantReplicateDocumentArgs = Type("AssistantReplicateDocumentArgs", func() {
	Attribute("document_id", String, "Local document identifier to copy")
	Attribute("count", Int, "Number of copies to create")
	Attribute("new_filename", String, "Optional filename for a single copy")
	Example(map[string]any{"document_id": "doc_123", "count": 2})
})

var AssistantDocumentCopy = Type("AssistantDocumentCopy", func() {
	Attribute("new_filename", String, "Copied document filename")
	Attribute("document_id", String, "New local document identifier")
	Attribute("version_id", String, "New version identifier")
	Attribute("download_url", String, "Local download URL")
})

var AssistantReplicatedDocuments = Type("AssistantReplicatedDocuments", func() {
	Attribute("ok", Boolean, "Whether replication succeeded")
	Attribute("filename", String, "Source filename")
	Attribute("count", Int, "Number of copies created")
	Attribute("copies", ArrayOf(AssistantDocumentCopy), "Created copies")
	Attribute("error", String, "Error message when replication failed")
})

var AssistantReadTableCellsArgs = Type("AssistantReadTableCellsArgs", func() {
	Attribute("review_id", String, "Tabular review identifier")
	Attribute("col_indices", ArrayOf(Int), "Column positions to read; omit for all")
	Attribute("row_indices", ArrayOf(Int), "Row positions to read; omit for all")
	Example(map[string]any{"review_id": "review_123", "col_indices": []int{0, 1}, "row_indices": []int{0}})
})

var AssistantTableCellsText = Type("AssistantTableCellsText", func() {
	Attribute("label", String, "Human-readable row/column count")
	Attribute("text", String, "Readable cell content")
})
