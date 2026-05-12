package design

import . "github.com/CaliLuke/loom/dsl"

var Application = Type("Application", func() {
	Attribute("id", String)
	Attribute("user_id", String)
	Attribute("is_owner", Boolean)
	Attribute("company_id", String)
	Attribute("company_name", String)
	Attribute("name", String)
	Attribute("shared_with", ArrayOf(String))
	Attribute("created_at", String)
	Attribute("updated_at", String)
	Attribute("documents", ArrayOf(Document))
	Attribute("folders", ArrayOf(Folder))
	Attribute("library_documents", ArrayOf(Document))
	Attribute("document_count", Int)
	Attribute("chat_count", Int)
	Attribute("review_count", Int)
	Required("id", "user_id", "company_id", "name", "shared_with", "created_at", "updated_at")
})

var ApplicationOwner = Type("ApplicationOwner", func() {
	Attribute("user_id", String)
	Attribute("email", String)
	Attribute("display_name", String)
	Required("user_id")
})

var ApplicationMember = Type("ApplicationMember", func() {
	Attribute("email", String)
	Attribute("display_name", String)
	Required("email")
})

var ApplicationPeople = Type("ApplicationPeople", func() {
	Attribute("owner", ApplicationOwner)
	Attribute("members", ArrayOf(ApplicationMember))
	Required("owner", "members")
})
