package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var _ = API("luke", func() {
	Title("Luke Local Workbench API")
	Description("Compatibility contract for the local-first Luke backend.")
	Version("0.1.0")
	DisableAgentDocs()

	Server("luke", func() {
		Description("Local browser development server")
		Host("localhost", func() {
			URI("http://localhost:3001")
		})
	})
})

var HealthResponse = Type("HealthResponse", func() {
	Attribute("ok", Boolean)
	Required("ok")
})

var _ = Service("system", func() {
	Method("health", func() {
		Result(HealthResponse)
		HTTP(func() {
			GET("/health")
			Response(StatusOK)
		})
	})
})
