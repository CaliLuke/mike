package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("tabular_chat", func() {
	Method("list", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Required("reviewId")
		})
		Result(ArrayOf(Chat))
		HTTP(func() {
			GET("/tabular-review/{reviewId}/chats")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Attribute("chatId", String)
			Required("reviewId", "chatId")
		})
		HTTP(func() {
			DELETE("/tabular-review/{reviewId}/chats/{chatId}")
			Response(StatusNoContent)
		})
	})

	Method("messages", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Attribute("chatId", String)
			Required("reviewId", "chatId")
		})
		Result(ArrayOf(ServerMessage))
		HTTP(func() {
			GET("/tabular-review/{reviewId}/chats/{chatId}/messages")
			Response(StatusOK)
		})
	})

	Method("stream", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Attribute("messages", ArrayOf(ChatMessage))
			Attribute("chat_id", String)
			Attribute("review_title", String)
			Attribute("project_name", String)
			Required("reviewId", "messages")
		})
		StreamingResult(SSEEvent)
		HTTP(func() {
			POST("/tabular-review/{reviewId}/chat")
			ServerSentEvents()
			Response(StatusOK)
		})
	})
})
