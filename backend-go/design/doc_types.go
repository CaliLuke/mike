package design

import . "github.com/CaliLuke/loom/dsl"

var StructureNode = Type("StructureNode", func() {
	Attribute("id", String)
	Attribute("title", String)
	Attribute("level", Int)
	Attribute("page_number", Int)
	Attribute("children", ArrayOf("StructureNode"))
	Required("id", "title", "level", "children")
})

var Folder = Type("Folder", func() {
	Attribute("id", String)
	Attribute("application_id", String)
	Attribute("user_id", String)
	Attribute("name", String)
	Attribute("parent_folder_id", String)
	Attribute("created_at", String)
	Attribute("updated_at", String)
	Required("id", "application_id", "user_id", "name", "created_at", "updated_at")
})

var PersonRef = Type("PersonRef", func() {
	Attribute("name", String)
	Attribute("role", String)
	Required("name")
})

var Document = Type("Document", func() {
	Attribute("id", String)
	Attribute("user_id", String)
	Attribute("application_id", String)
	Attribute("folder_id", String)
	Attribute("filename", String)
	Attribute("file_type", String)
	Attribute("storage_path", String)
	Attribute("pdf_storage_path", String)
	Attribute("size_bytes", Int64)
	Attribute("page_count", Int)
	Attribute("structure_tree", ArrayOf(StructureNode))
	Attribute("status", String, func() { Enum("pending", "processing", "ready", "error") })
	Attribute("created_at", String)
	Attribute("updated_at", String)
	Attribute("latest_version_number", Int)
	Attribute("library", Boolean)
	Attribute("library_kind", String, func() { Enum("shared", "reference") })
	Attribute("kind", String, func() {
		Enum(
			"resume", "resume_baseline", "job_description", "interview_transcript",
			"recruiter_notes", "prep_packet", "cheatsheet", "interviewer_bio", "schedule",
			"story", "about_me", "answer_bank", "framework", "references",
			"cover_letter", "writing_sample", "coaching_state", "unclassified",
		)
	})
	Attribute("interview_stage", String, func() {
		Enum("recruiter", "hiring_manager", "peer", "tech", "panel", "onsite", "other")
	})
	Attribute("topics", ArrayOf(String))
	Attribute("company_refs", ArrayOf(String))
	Attribute("people_refs", ArrayOf(PersonRef))
	Attribute("summary", String)
	Attribute("dated_event_at", String)
	Attribute("derived_from_id", String)
	Attribute("metadata_status", String, func() {
		Enum("unprocessed", "queued", "processing", "ready", "error", "user_confirmed")
	})
	Attribute("metadata_processed_at", String)
	Attribute("metadata_error", String)
	Attribute("linked_application_ids", ArrayOf(String))
	Required("id", "filename", "status")
})

var DocumentVersion = Type("DocumentVersion", func() {
	Attribute("id", String)
	Attribute("version_number", Int)
	Attribute("source", String)
	Attribute("created_at", String)
	Attribute("display_name", String)
	Required("id", "source", "created_at")
})

var DocumentVersions = Type("DocumentVersions", func() {
	Attribute("current_version_id", String)
	Attribute("versions", ArrayOf(DocumentVersion))
	Required("versions")
})

var FileUpload = Type("FileUpload", func() {
	Attribute("file", Bytes)
	Required("file")
})

var NamedFileUpload = Type("NamedFileUpload", func() {
	Attribute("file", Bytes)
	Attribute("display_name", String)
	Required("file")
})

var URLResponse = Type("URLResponse", func() {
	Attribute("url", String)
	Attribute("filename", String)
	Attribute("version_id", String)
	Required("url")
})

var TrackedChangeIDs = Type("TrackedChangeIDs", func() {
	Attribute("ids", ArrayOf(String))
	Required("ids")
})

var MetadataQueueAck = Type("MetadataQueueAck", func() {
	Attribute("queued_document_ids", ArrayOf(String))
	Attribute("status", String)
	Required("queued_document_ids", "status")
})

var MetadataBatchRequest = Type("MetadataBatchRequest", func() {
	Attribute("document_ids", ArrayOf(String))
	Attribute("filter", String, func() { Enum("unprocessed", "error", "all") })
})

var MetadataStatusCount = Type("MetadataStatusCount", func() {
	Attribute("metadata_status", String)
	Attribute("count", Int)
	Required("metadata_status", "count")
})

var MetadataQueueStats = Type("MetadataQueueStats", func() {
	Attribute("counts", ArrayOf(MetadataStatusCount))
	Required("counts")
})

var MetadataPatchPayload = Type("MetadataPatchPayload", func() {
	Attribute("documentId", String)
	Attribute("confirm", Boolean)
	Attribute("kind", String)
	Attribute("library", Boolean)
	Attribute("library_kind", String)
	Attribute("interview_stage", String)
	Attribute("summary", String)
	Attribute("topics", ArrayOf(String))
	Attribute("company_refs", ArrayOf(String))
	Attribute("people_refs", ArrayOf(PersonRef))
	Attribute("dated_event_at", String)
	Attribute("derived_from_id", String)
	Required("documentId")
})
