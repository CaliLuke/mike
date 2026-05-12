package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantWorkflowRef = Type("AssistantWorkflowRef", func() {
	Attribute("workflow_id", String, "Local workflow identifier")
	Attribute("title", String, "Workflow title")
	Attribute("type", String, "Workflow type")
	Attribute("practice", String, "Workflow practice or category")
})

var AssistantWorkflowList = Type("AssistantWorkflowList", func() {
	Attribute("workflows", ArrayOf(AssistantWorkflowRef), "Saved workflows")
})

func declareListWorkflowsTool() {
	Tool("list_workflows", "List saved local workflows available to the user", func() {
		Args(AssistantNoArgs)
		Return(AssistantWorkflowList)
	})
}
