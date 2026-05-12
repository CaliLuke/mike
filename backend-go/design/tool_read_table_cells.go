package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantReadTableCellsArgs = Type("AssistantReadTableCellsArgs", func() {
	Attribute("review_id", String, "Tabular review identifier")
	Attribute("col_indices", ArrayOf(Int), "Column positions to read; omit for all")
	Attribute("row_indices", ArrayOf(Int), "Row positions to read; omit for all")
	Example(map[string]any{"review_id": "review_123", "col_indices": []int{0, 1}, "row_indices": []int{0}})
})

var AssistantTableCellsText = Type("AssistantTableCellsText", func() {
	Attribute("label", String, "Human-readable row/column count")
	Attribute("text", String, "Readable cell content")
})

func declareReadTableCellsTool() {
	Tool("read_table_cells", "Read generated tabular review cells by row and column", func() {
		Args(AssistantReadTableCellsArgs)
		Return(AssistantTableCellsText)
	})
}
