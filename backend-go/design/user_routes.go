package design

import . "github.com/CaliLuke/loom/dsl"

var _ = Service("user", func() {
	Method("profile", func() {
		Result(UserProfile)
		HTTP(func() {
			POST("/user/profile")
			Response(StatusOK)
		})
	})

	Method("delete_account", func() {
		HTTP(func() {
			DELETE("/user/account")
			Response(StatusNoContent)
		})
	})
})

var _ = Service("users_alias", func() {
	Method("profile", func() {
		Result(UserProfile)
		HTTP(func() {
			POST("/users/profile")
			Response(StatusOK)
		})
	})

	Method("delete_account", func() {
		HTTP(func() {
			DELETE("/users/account")
			Response(StatusNoContent)
		})
	})
})

var _ = Service("downloads", func() {
	Method("download", func() {
		Payload(func() {
			Attribute("token", String)
			Required("token")
		})
		Result(Bytes)
		HTTP(func() {
			GET("/download/{token}")
			Response(StatusOK)
		})
	})
})
