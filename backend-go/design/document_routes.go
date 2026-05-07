package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("documents", func() {
	Method("list", func() {
		Result(ArrayOf(Document))
		HTTP(func() {
			GET("/single-documents")
			Response(StatusOK)
		})
	})

	Method("upload", func() {
		Payload(FileUpload)
		Result(Document)
		HTTP(func() {
			POST("/single-documents")
			MultipartRequest()
			Response(StatusCreated)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("documentId", String)
			Required("documentId")
		})
		HTTP(func() {
			DELETE("/single-documents/{documentId}")
			Response(StatusNoContent)
		})
	})

	Method("display", func() {
		Payload(func() {
			Attribute("documentId", String)
			Attribute("version_id", String)
			Required("documentId")
		})
		Result(Bytes)
		HTTP(func() {
			GET("/single-documents/{documentId}/display")
			Response(StatusOK)
		})
	})

	Method("download_zip", func() {
		Payload(func() {
			Attribute("document_ids", ArrayOf(String))
			Required("document_ids")
		})
		Result(Bytes)
		HTTP(func() {
			POST("/single-documents/download-zip")
			Response(StatusOK)
		})
	})

	Method("url", func() {
		Payload(func() {
			Attribute("documentId", String)
			Attribute("version_id", String)
			Required("documentId")
		})
		Result(URLResponse)
		HTTP(func() {
			GET("/single-documents/{documentId}/url")
			Response(StatusOK)
		})
	})

	Method("docx", func() {
		Payload(func() {
			Attribute("documentId", String)
			Attribute("version_id", String)
			Required("documentId")
		})
		Result(Bytes)
		HTTP(func() {
			GET("/single-documents/{documentId}/docx")
			Response(StatusOK)
		})
	})
})
