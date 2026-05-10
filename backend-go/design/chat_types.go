package design

import . "github.com/CaliLuke/loom/dsl"

var Chat = Type("Chat", func() {
	Attribute("id", String)
	Attribute("application_id", String)
	Attribute("user_id", String)
	Attribute("title", String)
	Attribute("created_at", String)
	Required("id", "user_id", "created_at")
})

var MessageFile = Type("MessageFile", func() {
	Attribute("filename", String)
	Attribute("document_id", String)
	Required("filename")
})

var MessageWorkflow = Type("MessageWorkflow", func() {
	Attribute("id", String)
	Attribute("title", String)
	Required("id", "title")
})

var CitationAnnotation = Type("CitationAnnotation", func() {
	Attribute("type", String, func() { Enum("citation_data") })
	Attribute("ref", Int)
	Attribute("doc_id", String)
	Attribute("document_id", String)
	Attribute("version_id", String)
	Attribute("version_number", Int)
	Attribute("filename", String)
	Attribute("page", Any)
	Attribute("quote", String)
	Required("type", "ref", "doc_id", "document_id", "filename", "page", "quote")
})

var EditAnnotation = Type("EditAnnotation", func() {
	Attribute("type", String)
	Attribute("kind", String)
	Attribute("edit_id", String)
	Attribute("document_id", String)
	Attribute("version_id", String)
	Attribute("version_number", Int)
	Attribute("change_id", String)
	Attribute("del_w_id", String)
	Attribute("ins_w_id", String)
	Attribute("deleted_text", String)
	Attribute("inserted_text", String)
	Attribute("context_before", String)
	Attribute("context_after", String)
	Attribute("reason", String)
	Attribute("status", String, func() { Enum("pending", "accepted", "rejected") })
	Required("edit_id", "document_id", "version_id", "change_id", "deleted_text", "inserted_text", "status")
})

var AssistantEvent = Type("AssistantEvent", func() {
	Attribute("type", String)
	Attribute("text", String)
	Attribute("name", String)
	Attribute("filename", String)
	Attribute("document_id", String)
	Attribute("version_id", String)
	Attribute("version_number", Int)
	Attribute("download_url", String)
	Attribute("query", String)
	Attribute("total_matches", Int)
	Attribute("count", Int)
	Attribute("workflow_id", String)
	Attribute("title", String)
	Attribute("annotations", ArrayOf(EditAnnotation))
	Attribute("error", String)
	Attribute("isStreaming", Boolean)
	Required("type")
})

var ChatMessage = Type("ChatMessage", func() {
	Attribute("role", String, func() { Enum("user", "assistant") })
	Attribute("content", String)
	Attribute("files", ArrayOf(MessageFile))
	Attribute("workflow", MessageWorkflow)
	Attribute("model", String)
	Attribute("annotations", ArrayOf(CitationAnnotation))
	Attribute("events", ArrayOf(AssistantEvent))
	Attribute("error", String)
	Required("role", "content")
})

var ServerMessage = Type("ServerMessage", func() {
	Attribute("id", String)
	Attribute("chat_id", String)
	Extend(ChatMessage)
	Attribute("created_at", String)
	Required("id", "chat_id", "role", "created_at")
})

var ChatDetail = Type("ChatDetail", func() {
	Attribute("chat", Chat)
	Attribute("messages", ArrayOf(ServerMessage))
	Required("chat", "messages")
})

var TitleResponse = Type("TitleResponse", func() {
	Attribute("title", String)
	Required("title")
})

var IDResponse = Type("IDResponse", func() {
	Attribute("id", String)
	Required("id")
})

var SSEEvent = Type("SSEEvent", func() {
	Attribute("type", String)
	Attribute("text", String)
	Attribute("message", String)
	Attribute("data", Any)
	Attribute("event", AssistantEvent)
	Attribute("cell", TabularCell)
	Attribute("annotations", ArrayOf(CitationAnnotation))
	Attribute("error", String)
	Required("type")
})
