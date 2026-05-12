package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("applications", func() {
	Method("list", func() {
		Result(ArrayOf(Application))
		HTTP(func() {
			GET("/applications")
			Response(StatusOK)
		})
	})

	Method("create", func() {
		Payload(func() {
			Attribute("name", String)
			Attribute("company_id", String)
			Attribute("shared_with", ArrayOf(String))
			Required("name", "company_id")
		})
		Result(Application)
		HTTP(func() {
			POST("/applications")
			Response(StatusCreated)
		})
	})

	Method("get", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Required("applicationId")
		})
		Result(Application)
		HTTP(func() {
			GET("/applications/{applicationId}")
			Response(StatusOK)
		})
	})

	Method("update", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Attribute("name", String)
			Attribute("company_id", String)
			Attribute("shared_with", ArrayOf(String))
			Required("applicationId")
		})
		Result(Application)
		HTTP(func() {
			PATCH("/applications/{applicationId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Required("applicationId")
		})
		HTTP(func() {
			DELETE("/applications/{applicationId}")
			Response(StatusNoContent)
		})
	})

	Method("people", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Required("applicationId")
		})
		Result(ApplicationPeople)
		HTTP(func() {
			GET("/applications/{applicationId}/people")
			Response(StatusOK)
		})
	})

	Method("documents", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Required("applicationId")
		})
		Result(ArrayOf(Document))
		HTTP(func() {
			GET("/applications/{applicationId}/documents")
			Response(StatusOK)
		})
	})

	Method("add_document", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Attribute("documentId", String)
			Required("applicationId", "documentId")
		})
		Result(Document)
		HTTP(func() {
			POST("/applications/{applicationId}/documents/{documentId}")
			Response(StatusOK)
		})
	})

	Method("upload_document", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Extend(FileUpload)
			Required("applicationId", "file")
		})
		Result(Document)
		HTTP(func() {
			POST("/applications/{applicationId}/documents")
			MultipartRequest()
			Response(StatusCreated)
		})
	})

	Method("chats", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Required("applicationId")
		})
		Result(ArrayOf(Chat))
		HTTP(func() {
			GET("/applications/{applicationId}/chats")
			Response(StatusOK)
		})
	})
})
