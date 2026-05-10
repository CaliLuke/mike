package design

import . "github.com/CaliLuke/loom/dsl"

var ColumnConfig = Type("ColumnConfig", func() {
	Attribute("index", Int)
	Attribute("name", String)
	Attribute("prompt", String)
	Attribute("format", String, func() {
		Enum("text", "bulleted_list", "number", "currency", "yes_no", "date", "tag", "percentage", "monetary_amount")
	})
	Attribute("tags", ArrayOf(String))
	Required("index", "name", "prompt")
})

var TabularReview = Type("TabularReview", func() {
	Attribute("id", String)
	Attribute("application_id", String)
	Attribute("user_id", String)
	Attribute("title", String)
	Attribute("columns_config", ArrayOf(ColumnConfig))
	Attribute("workflow_id", String)
	Attribute("practice", String)
	Attribute("created_at", String)
	Attribute("updated_at", String)
	Attribute("document_count", Int)
	Required("id", "user_id", "created_at", "updated_at")
})

var TabularCellContent = Type("TabularCellContent", func() {
	Attribute("summary", String)
	Attribute("flag", String, func() { Enum("green", "grey", "yellow", "red") })
	Attribute("reasoning", String)
	Required("summary")
})

var TabularCell = Type("TabularCell", func() {
	Attribute("id", String)
	Attribute("review_id", String)
	Attribute("document_id", String)
	Attribute("column_index", Int)
	Attribute("content", TabularCellContent)
	Attribute("status", String, func() { Enum("pending", "generating", "done", "error") })
	Attribute("created_at", String)
	Required("id", "review_id", "document_id", "column_index", "status", "created_at")
})

var TabularReviewDetail = Type("TabularReviewDetail", func() {
	Attribute("review", TabularReview)
	Attribute("cells", ArrayOf(TabularCell))
	Attribute("documents", ArrayOf(Document))
	Required("review", "cells", "documents")
})

var PromptResponse = Type("PromptResponse", func() {
	Attribute("prompt", String)
	Attribute("source", String, func() { Enum("preset", "llm", "fallback") })
	Required("prompt")
})
