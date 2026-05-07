package design

import . "github.com/CaliLuke/loom/dsl"

var Project = Type("Project", func() {
	Attribute("id", String)
	Attribute("user_id", String)
	Attribute("is_owner", Boolean)
	Attribute("name", String)
	Attribute("cm_number", String)
	Attribute("shared_with", ArrayOf(String))
	Attribute("created_at", String)
	Attribute("updated_at", String)
	Attribute("documents", ArrayOf(Document))
	Attribute("folders", ArrayOf(Folder))
	Attribute("document_count", Int)
	Attribute("chat_count", Int)
	Attribute("review_count", Int)
	Required("id", "user_id", "name", "shared_with", "created_at", "updated_at")
})

var ProjectOwner = Type("ProjectOwner", func() {
	Attribute("user_id", String)
	Attribute("email", String)
	Attribute("display_name", String)
	Required("user_id")
})

var ProjectMember = Type("ProjectMember", func() {
	Attribute("email", String)
	Attribute("display_name", String)
	Required("email")
})

var ProjectPeople = Type("ProjectPeople", func() {
	Attribute("owner", ProjectOwner)
	Attribute("members", ArrayOf(ProjectMember))
	Required("owner", "members")
})
