package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var _ = Service("chat", func() {
	Agent("assistant", "Career operations assistant for resumes, job searches, and application materials", func() {
		Use("career_context", func() {
			Tool("list_documents", "List local documents available to the current chat", func() {
				Args(AssistantNoArgs)
				Return(AssistantDocumentList)
			})
			Tool("read_document", "Read the text content of one local document", func() {
				Args(AssistantReadDocumentArgs)
				Return(AssistantDocumentText)
			})
			Tool("find_in_document", "Find exact text matches in one local document", func() {
				Args(AssistantFindDocumentArgs)
				Return(AssistantDocumentMatches)
			})
			Tool("fetch_documents", "Fetch text from multiple local documents", func() {
				Args(AssistantFetchDocumentsArgs)
				Return(AssistantDocumentBundle)
			})
			Tool("list_workflows", "List saved local workflows available to the user", func() {
				Args(AssistantNoArgs)
				Return(AssistantWorkflowList)
			})
			Tool("read_workflow", "Read one saved local workflow", func() {
				Args(AssistantReadWorkflowArgs)
				Return(AssistantWorkflowText)
			})
			Tool("generate_docx", "Generate a new editable DOCX document and store it locally", func() {
				Args(AssistantGenerateDocxArgs)
				Return(AssistantGeneratedDocument)
			})
			Tool("edit_document", "Apply text replacements to an editable DOCX document as a new version", func() {
				Args(AssistantEditDocumentArgs)
				Return(AssistantEditedDocument)
			})
			Tool("replicate_document", "Copy an existing document into one or more new local documents", func() {
				Args(AssistantReplicateDocumentArgs)
				Return(AssistantReplicatedDocuments)
			})
			Tool("read_table_cells", "Read generated tabular review cells by row and column", func() {
				Args(AssistantReadTableCellsArgs)
				Return(AssistantTableCellsText)
			})
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
			Attribute("project_id", String)
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
			Attribute("project_id", String)
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

var _ = Service("project_chat", func() {
	Method("stream", func() {
		Payload(func() {
			Attribute("projectId", String)
			Attribute("messages", ArrayOf(ChatMessage))
			Attribute("chat_id", String)
			Attribute("model", String)
			Attribute("displayed_doc", MessageFile)
			Attribute("attached_documents", ArrayOf(MessageFile))
			Required("projectId", "messages")
		})
		StreamingResult(SSEEvent)
		HTTP(func() {
			POST("/projects/{projectId}/chat")
			ServerSentEvents()
			Response(StatusOK)
		})
	})
})
