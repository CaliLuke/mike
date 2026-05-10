package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("workflows", func() {
	Method("list", func() {
		Payload(func() {
			Attribute("type", String, func() { Enum("assistant", "tabular") })
		})
		Result(ArrayOf(Workflow))
		HTTP(func() {
			GET("/workflows")
			Response(StatusOK)
		})
	})

	Method("create", func() {
		Payload(func() {
			Attribute("title", String)
			Attribute("type", String, func() { Enum("assistant", "tabular") })
			Attribute("prompt_md", String)
			Attribute("columns_config", ArrayOf(ColumnConfig))
			Attribute("practice", String)
			Required("title", "type")
		})
		Result(Workflow)
		HTTP(func() {
			POST("/workflows")
			Response(StatusCreated)
		})
	})

	Method("replace", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Attribute("title", String)
			Attribute("prompt_md", String)
			Attribute("columns_config", ArrayOf(ColumnConfig))
			Attribute("practice", String)
			Required("workflowId")
		})
		Result(Workflow)
		HTTP(func() {
			PUT("/workflows/{workflowId}")
			Response(StatusOK)
		})
	})

	Method("update", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Attribute("title", String)
			Attribute("prompt_md", String)
			Attribute("columns_config", ArrayOf(ColumnConfig))
			Attribute("practice", String)
			Required("workflowId")
		})
		Result(Workflow)
		HTTP(func() {
			PATCH("/workflows/{workflowId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Required("workflowId")
		})
		HTTP(func() {
			DELETE("/workflows/{workflowId}")
			Response(StatusNoContent)
		})
	})

	Method("hidden", func() {
		Result(ArrayOf(String))
		HTTP(func() {
			GET("/workflows/hidden")
			Response(StatusOK)
		})
	})

	Method("hide", func() {
		Payload(func() {
			Attribute("workflow_id", String)
			Required("workflow_id")
		})
		HTTP(func() {
			POST("/workflows/hidden")
			Response(StatusNoContent)
		})
	})

	Method("unhide", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Required("workflowId")
		})
		HTTP(func() {
			DELETE("/workflows/hidden/{workflowId}")
			Response(StatusNoContent)
		})
	})

	Method("get", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Required("workflowId")
		})
		Result(Workflow)
		HTTP(func() {
			GET("/workflows/{workflowId}")
			Response(StatusOK)
		})
	})

	Method("shares", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Required("workflowId")
		})
		Result(ArrayOf(WorkflowShare))
		HTTP(func() {
			GET("/workflows/{workflowId}/shares")
			Response(StatusOK)
		})
	})

	Method("delete_share", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Attribute("shareId", String)
			Required("workflowId", "shareId")
		})
		HTTP(func() {
			DELETE("/workflows/{workflowId}/shares/{shareId}")
			Response(StatusNoContent)
		})
	})

	Method("share", func() {
		Payload(func() {
			Attribute("workflowId", String)
			Attribute("emails", ArrayOf(String))
			Attribute("allow_edit", Boolean)
			Required("workflowId", "emails", "allow_edit")
		})
		HTTP(func() {
			POST("/workflows/{workflowId}/share")
			Response(StatusNoContent)
		})
	})

})
