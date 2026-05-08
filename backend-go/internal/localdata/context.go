package localdata

import (
	"context"
	"net/http"
)

const (
	LocalUserID    = "local-user"
	LocalUserEmail = "local@luke.local"
	LocalUserToken = "local-mode"
)

type UserContext struct {
	UserID    string
	UserEmail string
	Token     string
}

type userContextKey struct{}

func LocalUser() UserContext {
	return UserContext{
		UserID:    LocalUserID,
		UserEmail: LocalUserEmail,
		Token:     LocalUserToken,
	}
}

func WithUserContext(ctx context.Context, user UserContext) context.Context {
	return context.WithValue(ctx, userContextKey{}, user)
}

func UserFromContext(ctx context.Context) UserContext {
	user, ok := ctx.Value(userContextKey{}).(UserContext)
	if !ok {
		return LocalUser()
	}
	return user
}

func LocalUserMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(WithUserContext(r.Context(), LocalUser())))
	})
}
