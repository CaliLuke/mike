package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

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

func declareEditDocumentTool() {
	Tool("edit_document", "Apply text replacements to an editable DOCX document as a new version", func() {
		Args(AssistantEditDocumentArgs)
		Return(AssistantEditedDocument)
	})
}
