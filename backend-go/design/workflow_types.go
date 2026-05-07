package design

import . "github.com/CaliLuke/loom/dsl"

var Workflow = Type("Workflow", func() {
	Attribute("id", String)
	Attribute("user_id", String)
	Attribute("title", String)
	Attribute("type", String, func() { Enum("assistant", "tabular") })
	Attribute("prompt_md", String)
	Attribute("columns_config", ArrayOf(ColumnConfig))
	Attribute("is_system", Boolean)
	Attribute("created_at", String)
	Attribute("practice", String)
	Attribute("shared_by_name", String)
	Attribute("allow_edit", Boolean)
	Attribute("is_owner", Boolean)
	Required("id", "title", "type", "is_system", "created_at")
})

var WorkflowShare = Type("WorkflowShare", func() {
	Attribute("id", String)
	Attribute("shared_with_email", String)
	Attribute("allow_edit", Boolean)
	Attribute("created_at", String)
	Required("id", "shared_with_email", "allow_edit", "created_at")
})
