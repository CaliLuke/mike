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

	Method("process_metadata", func() {
		Description("Queue a single document for deferred metadata classification. Spawns a background goroutine that runs the classifier against the document's stored text twin.")
		Payload(func() {
			Attribute("documentId", String)
			Required("documentId")
		})
		Result(MetadataQueueAck)
		HTTP(func() {
			POST("/single-documents/{documentId}/process-metadata")
			Response(StatusAccepted)
		})
	})

	Method("process_metadata_batch", func() {
		Description("Queue many documents for deferred metadata classification. Either pass an explicit document_ids list, or a filter like 'unprocessed' to enqueue every matching row.")
		Payload(MetadataBatchRequest)
		Result(MetadataQueueAck)
		HTTP(func() {
			POST("/single-documents/process-metadata")
			Response(StatusAccepted)
		})
	})

	Method("metadata_queue", func() {
		Description("Return the current metadata-processing queue counts grouped by metadata_status.")
		Result(MetadataQueueStats)
		HTTP(func() {
			GET("/single-documents/metadata-queue")
			Response(StatusOK)
		})
	})

	Method("patch_metadata", func() {
		Description("Apply user overrides to a document's classifier output. When confirm=true, flips metadata_status to user_confirmed.")
		Payload(MetadataPatchPayload)
		Result(Document)
		HTTP(func() {
			PATCH("/single-documents/{documentId}/metadata")
			Response(StatusOK)
		})
	})
})
