package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("document_versions", func() {
	Method("list", func() {
		Payload(func() {
			Attribute("documentId", String)
			Required("documentId")
		})
		Result(DocumentVersions)
		HTTP(func() {
			GET("/single-documents/{documentId}/versions")
			Response(StatusOK)
		})
	})

	Method("upload", func() {
		Payload(func() {
			Attribute("documentId", String)
			Extend(NamedFileUpload)
			Required("documentId", "file")
		})
		Result(DocumentVersion)
		HTTP(func() {
			POST("/single-documents/{documentId}/versions")
			MultipartRequest()
			Response(StatusCreated)
		})
	})

	Method("rename", func() {
		Payload(func() {
			Attribute("documentId", String)
			Attribute("versionId", String)
			Attribute("display_name", String)
			Required("documentId", "versionId")
		})
		Result(DocumentVersion)
		HTTP(func() {
			PATCH("/single-documents/{documentId}/versions/{versionId}")
			Response(StatusOK)
		})
	})

	Method("tracked_change_ids", func() {
		Payload(func() {
			Attribute("documentId", String)
			Attribute("version_id", String)
			Required("documentId")
		})
		Result(TrackedChangeIDs)
		HTTP(func() {
			GET("/single-documents/{documentId}/tracked-change-ids")
			Response(StatusOK)
		})
	})

	Method("accept_edit", func() {
		Payload(func() {
			Attribute("documentId", String)
			Attribute("editId", String)
			Required("documentId", "editId")
		})
		Result(EditAnnotation)
		HTTP(func() {
			POST("/single-documents/{documentId}/edits/{editId}/accept")
			Response(StatusOK)
		})
	})

	Method("reject_edit", func() {
		Payload(func() {
			Attribute("documentId", String)
			Attribute("editId", String)
			Required("documentId", "editId")
		})
		Result(EditAnnotation)
		HTTP(func() {
			POST("/single-documents/{documentId}/edits/{editId}/reject")
			Response(StatusOK)
		})
	})
})
