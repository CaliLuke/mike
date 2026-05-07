package design

import . "github.com/CaliLuke/loom/dsl"

var UserProfile = Type("UserProfile", func() {
	Attribute("ok", Boolean)
	Attribute("id", String)
	Attribute("email", String)
	Attribute("display_name", String)
	Attribute("tier", String)
	Attribute("credits", Int)
	Attribute("credits_reset_at", String)
	Attribute("settings", MapOf(String, Any))
	Required("ok")
})
