package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var _ = Service("chat", func() {
	Agent("assistant", "Career operations assistant for resumes, job searches, and application materials", func() {
		Use("career_context", func() {
			// One file per tool under design/tool_<name>.go — scan that
			// directory for the full inventory. New tools: add a
			// tool_<name>.go file with Args + Result types and a
			// declareXxxTool() helper, then drop a single line below.
			declareListDocumentsTool()
			declareReadDocumentTool()
			declareFindInDocumentTool()
			declareFetchDocumentsTool()
			declareFetchWebPageTool()
			declareListWorkflowsTool()
			declareReadWorkflowTool()
			declareSearchCompaniesTool()
			declareCreateCompanyTool()
			declareSearchDocumentsTool()
			declareSaveDocumentTool()
			declareAttachDocumentTool()
			declareDeleteDocumentTool()
			declareCreateApplicationTool()
			declareSetApplicationCompanyTool()
			declareGenerateDocxTool()
			declareEditDocumentTool()
			declareReplicateDocumentTool()
			declareReadTableCellsTool()
		})
		RunPolicy(func() {
			DefaultCaps(MaxToolCalls(8), MaxConsecutiveFailedToolCalls(3))
			TimeBudget("2m")
		})
	})

	Method("list", func() {
		Result(ArrayOf(Chat))
		HTTP(func() {
			GET("/chat")
			Response(StatusOK)
		})
	})

	Method("create", func() {
		Payload(func() {
			Attribute("application_id", String)
		})
		Result(IDResponse)
		HTTP(func() {
			POST("/chat/create")
			Response(StatusOK)
		})
	})

	Method("get", func() {
		Payload(func() {
			Attribute("chatId", String)
			Required("chatId")
		})
		Result(ChatDetail)
		HTTP(func() {
			GET("/chat/{chatId}")
			Response(StatusOK)
		})
	})

	Method("rename", func() {
		Payload(func() {
			Attribute("chatId", String)
			Attribute("title", String)
			Required("chatId", "title")
		})
		Result(Chat)
		HTTP(func() {
			PATCH("/chat/{chatId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("chatId", String)
			Required("chatId")
		})
		HTTP(func() {
			DELETE("/chat/{chatId}")
			Response(StatusNoContent)
		})
	})

	Method("generate_title", func() {
		Payload(func() {
			Attribute("chatId", String)
			Attribute("message", String)
			Required("chatId", "message")
		})
		Result(TitleResponse)
		HTTP(func() {
			POST("/chat/{chatId}/generate-title")
			Response(StatusOK)
		})
	})

	Method("stream", func() {
		Payload(func() {
			Attribute("messages", ArrayOf(ChatMessage))
			Attribute("chat_id", String)
			Attribute("application_id", String)
			Attribute("model", String)
			Required("messages")
		})
		StreamingResult(SSEEvent)
		HTTP(func() {
			POST("/chat")
			ServerSentEvents()
			Response(StatusOK)
		})
	})
})

var _ = Service("application_chat", func() {
	Method("stream", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Attribute("messages", ArrayOf(ChatMessage))
			Attribute("chat_id", String)
			Attribute("model", String)
			Attribute("displayed_doc", MessageFile)
			Attribute("attached_documents", ArrayOf(MessageFile))
			Required("applicationId", "messages")
		})
		StreamingResult(SSEEvent)
		HTTP(func() {
			POST("/applications/{applicationId}/chat")
			ServerSentEvents()
			Response(StatusOK)
		})
	})
})
