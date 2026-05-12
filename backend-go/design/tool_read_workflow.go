package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantReadWorkflowArgs = Type("AssistantReadWorkflowArgs", func() {
	Attribute("workflow_id", String, "Local workflow identifier to read")
	Example(map[string]any{"workflow_id": "workflow_123"})
})

var AssistantWorkflowText = Type("AssistantWorkflowText", func() {
	Attribute("workflow_id", String, "Local workflow identifier")
	Attribute("title", String, "Workflow title")
	Attribute("type", String, "Workflow type")
	Attribute("prompt_md", String, "Workflow prompt")
	Attribute("columns_config", ArrayOf(Any), "Workflow column configuration")
	Attribute("practice", String, "Workflow practice or category")
})

func declareReadWorkflowTool() {
	Tool("read_workflow", "Read one saved local workflow", func() {
		Args(AssistantReadWorkflowArgs)
		Return(AssistantWorkflowText)
	})
}
