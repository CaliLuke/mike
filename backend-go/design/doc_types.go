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
