package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("projects", func() {
	Method("list", func() {
		Result(ArrayOf(Project))
		HTTP(func() {
			GET("/projects")
			Response(StatusOK)
		})
	})

	Method("create", func() {
		Payload(func() {
			Attribute("name", String)
			Attribute("cm_number", String)
			Attribute("shared_with", ArrayOf(String))
			Required("name")
		})
		Result(Project)
		HTTP(func() {
			POST("/projects")
			Response(StatusCreated)
		})
	})

	Method("get", func() {
		Payload(func() {
			Attribute("projectId", String)
			Required("projectId")
		})
		Result(Project)
		HTTP(func() {
			GET("/projects/{projectId}")
			Response(StatusOK)
		})
	})

	Method("update", func() {
		Payload(func() {
			Attribute("projectId", String)
			Attribute("name", String)
			Attribute("cm_number", String)
			Attribute("shared_with", ArrayOf(String))
			Required("projectId")
		})
		Result(Project)
		HTTP(func() {
			PATCH("/projects/{projectId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("projectId", String)
			Required("projectId")
		})
		HTTP(func() {
			DELETE("/projects/{projectId}")
			Response(StatusNoContent)
		})
	})

	Method("people", func() {
		Payload(func() {
			Attribute("projectId", String)
			Required("projectId")
		})
		Result(ProjectPeople)
		HTTP(func() {
			GET("/projects/{projectId}/people")
			Response(StatusOK)
		})
	})

	Method("documents", func() {
		Payload(func() {
			Attribute("projectId", String)
			Required("projectId")
		})
		Result(ArrayOf(Document))
		HTTP(func() {
			GET("/projects/{projectId}/documents")
			Response(StatusOK)
		})
	})

	Method("add_document", func() {
		Payload(func() {
			Attribute("projectId", String)
			Attribute("documentId", String)
			Required("projectId", "documentId")
		})
		Result(Document)
		HTTP(func() {
			POST("/projects/{projectId}/documents/{documentId}")
			Response(StatusOK)
		})
	})

	Method("upload_document", func() {
		Payload(func() {
			Attribute("projectId", String)
			Extend(FileUpload)
			Required("projectId", "file")
		})
		Result(Document)
		HTTP(func() {
			POST("/projects/{projectId}/documents")
			MultipartRequest()
			Response(StatusCreated)
		})
	})

	Method("chats", func() {
		Payload(func() {
			Attribute("projectId", String)
			Required("projectId")
		})
		Result(ArrayOf(Chat))
		HTTP(func() {
			GET("/projects/{projectId}/chats")
			Response(StatusOK)
		})
	})
})
