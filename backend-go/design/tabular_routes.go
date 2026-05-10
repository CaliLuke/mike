package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("tabular", func() {
	Method("list", func() {
		Payload(func() {
			Attribute("application_id", String)
		})
		Result(ArrayOf(TabularReview))
		HTTP(func() {
			GET("/tabular-review")
			Response(StatusOK)
		})
	})

	Method("create", func() {
		Payload(func() {
			Attribute("title", String)
			Attribute("document_ids", ArrayOf(String))
			Attribute("columns_config", ArrayOf(ColumnConfig))
			Attribute("workflow_id", String)
			Attribute("application_id", String)
			Required("document_ids", "columns_config")
		})
		Result(TabularReview)
		HTTP(func() {
			POST("/tabular-review")
			Response(StatusCreated)
		})
	})

	Method("prompt", func() {
		Payload(func() {
			Attribute("title", String)
			Attribute("format", String)
			Attribute("documentName", String)
			Attribute("tags", ArrayOf(String))
			Required("title")
		})
		Result(PromptResponse)
		HTTP(func() {
			POST("/tabular-review/prompt")
			Response(StatusOK)
		})
	})

	Method("get", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Required("reviewId")
		})
		Result(TabularReviewDetail)
		HTTP(func() {
			GET("/tabular-review/{reviewId}")
			Response(StatusOK)
		})
	})

	Method("update", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Attribute("title", String)
			Attribute("columns_config", ArrayOf(ColumnConfig))
			Attribute("document_ids", ArrayOf(String))
			Attribute("application_id", String)
			Required("reviewId")
		})
		Result(TabularReview)
		HTTP(func() {
			PATCH("/tabular-review/{reviewId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Required("reviewId")
		})
		HTTP(func() {
			DELETE("/tabular-review/{reviewId}")
			Response(StatusNoContent)
		})
	})

	Method("clear_cells", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Attribute("document_ids", ArrayOf(String))
			Required("reviewId", "document_ids")
		})
		HTTP(func() {
			POST("/tabular-review/{reviewId}/clear-cells")
			Response(StatusNoContent)
		})
	})

	Method("regenerate_cell", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Attribute("document_id", String)
			Attribute("column_index", Int)
			Required("reviewId", "document_id", "column_index")
		})
		Result(TabularCellContent)
		HTTP(func() {
			POST("/tabular-review/{reviewId}/regenerate-cell")
			Response(StatusOK)
		})
	})

	Method("generate", func() {
		Payload(func() {
			Attribute("reviewId", String)
			Required("reviewId")
		})
		StreamingResult(SSEEvent)
		HTTP(func() {
			POST("/tabular-review/{reviewId}/generate")
			ServerSentEvents()
			Response(StatusOK)
		})
	})
})
