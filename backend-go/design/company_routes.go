package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("companies", func() {
	Method("list", func() {
		Result(ArrayOf(Company))
		HTTP(func() {
			GET("/companies")
			Response(StatusOK)
		})
	})

	Method("create", func() {
		Payload(func() {
			Attribute("name", String)
			Attribute("website", String)
			Required("name")
		})
		Result(Company)
		HTTP(func() {
			POST("/companies")
			Response(StatusCreated)
		})
	})

	Method("get", func() {
		Payload(func() {
			Attribute("companyId", String)
			Required("companyId")
		})
		Result(Company)
		HTTP(func() {
			GET("/companies/{companyId}")
			Response(StatusOK)
		})
	})

	Method("update", func() {
		Payload(func() {
			Attribute("companyId", String)
			Attribute("name", String)
			Attribute("website", String)
			Required("companyId")
		})
		Result(Company)
		HTTP(func() {
			PATCH("/companies/{companyId}")
			Response(StatusOK)
		})
	})

	Method("delete", func() {
		Payload(func() {
			Attribute("companyId", String)
			Required("companyId")
		})
		HTTP(func() {
			DELETE("/companies/{companyId}")
			Response(StatusNoContent)
		})
	})
})
