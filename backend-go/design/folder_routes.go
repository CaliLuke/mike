package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("folders", func() {
	Method("create", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Attribute("name", String)
			Attribute("parent_folder_id", String)
			Required("applicationId", "name")
		})
		Result(Folder)
		HTTP(func() {
			POST("/applications/{applicationId}/folders")
			Response(StatusCreated)
		})
	})

	Method("update", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Attribute("folderId", String)
			Attribute("name", String)
			Attribute("parent_folder_id", String)
			Required("applicationId", "folderId")
		})
		Result(Folder)
		HTTP(func() {
			PATCH("/applications/{applicationId}/folders/{folderId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Attribute("folderId", String)
			Required("applicationId", "folderId")
		})
		HTTP(func() {
			DELETE("/applications/{applicationId}/folders/{folderId}")
			Response(StatusNoContent)
		})
	})

	Method("move_document", func() {
		Payload(func() {
			Attribute("applicationId", String)
			Attribute("documentId", String)
			Attribute("folder_id", String)
			Required("applicationId", "documentId")
		})
		Result(Document)
		HTTP(func() {
			PATCH("/applications/{applicationId}/documents/{documentId}/folder")
			Response(StatusOK)
		})
	})
})
