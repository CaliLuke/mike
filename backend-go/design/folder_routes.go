package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("folders", func() {
	Method("create", func() {
		Payload(func() {
			Attribute("projectId", String)
			Attribute("name", String)
			Attribute("parent_folder_id", String)
			Required("projectId", "name")
		})
		Result(Folder)
		HTTP(func() {
			POST("/projects/{projectId}/folders")
			Response(StatusCreated)
		})
	})

	Method("update", func() {
		Payload(func() {
			Attribute("projectId", String)
			Attribute("folderId", String)
			Attribute("name", String)
			Attribute("parent_folder_id", String)
			Required("projectId", "folderId")
		})
		Result(Folder)
		HTTP(func() {
			PATCH("/projects/{projectId}/folders/{folderId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("projectId", String)
			Attribute("folderId", String)
			Required("projectId", "folderId")
		})
		HTTP(func() {
			DELETE("/projects/{projectId}/folders/{folderId}")
			Response(StatusNoContent)
		})
	})

	Method("move_document", func() {
		Payload(func() {
			Attribute("projectId", String)
			Attribute("documentId", String)
			Attribute("folder_id", String)
			Required("projectId", "documentId")
		})
		Result(Document)
		HTTP(func() {
			PATCH("/projects/{projectId}/documents/{documentId}/folder")
			Response(StatusOK)
		})
	})
})
