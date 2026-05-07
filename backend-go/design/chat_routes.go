package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("chat", func() {
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
