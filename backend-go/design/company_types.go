package design

import . "github.com/CaliLuke/loom/dsl"

var Company = Type("Company", func() {
	Attribute("id", String)
	Attribute("user_id", String)
	Attribute("name", String)
	Attribute("website", String)
	Attribute("created_at", String)
	Attribute("updated_at", String)
	Attribute("application_count", Int)
	Required("id", "user_id", "name", "created_at", "updated_at")
})
