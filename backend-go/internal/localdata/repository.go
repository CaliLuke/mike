package localdata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/CaliLuke/luke/backend-go/internal/persistence"
)

const BrowserLocalOrigin = "http://localhost:3000"

// isLocalOrigin returns true for any http(s) origin pointing at localhost
// or 127.0.0.1 on any port. Safe because this server only binds to loopback.
func isLocalOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	for _, prefix := range []string{
		"http://localhost", "http://127.0.0.1",
		"https://localhost", "https://127.0.0.1",
	} {
		if strings.HasPrefix(origin, prefix) {
			rest := origin[len(prefix):]
			if rest == "" || rest[0] == ':' || rest[0] == '/' {
				return true
			}
		}
	}
	return false
}

type DownloadToken struct {
	Token     string         `json:"token"`
	Payload   map[string]any `json:"payload"`
	ExpiresAt time.Time      `json:"expires_at"`
}

func LocalCORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isLocalOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, traceparent, tracestate, baggage")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func CreateDownloadToken(ctx context.Context, db *persistence.DB, payload map[string]any, ttl time.Duration) (DownloadToken, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	token, err := randomToken()
	if err != nil {
		return DownloadToken{}, fmt.Errorf("generate download token: %w", err)
	}
	expiresAt := time.Now().UTC().Add(ttl)
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return DownloadToken{}, fmt.Errorf("marshal download token payload: %w", err)
	}
	_, err = db.Query(ctx, fmt.Sprintf(`
		CREATE download_tokens CONTENT {
			user_id: users:local,
			token: %s,
			payload: %s,
			expires_at: d%s,
			created_at: time::now()
		};
	`, surrealString(token), string(payloadJSON), surrealString(expiresAt.Format(time.RFC3339Nano))))
	if err != nil {
		return DownloadToken{}, err
	}
	return DownloadToken{Token: token, Payload: payload, ExpiresAt: expiresAt}, nil
}

func ResolveDownloadToken(ctx context.Context, db *persistence.DB, token string) (DownloadToken, error) {
	rows, err := queryRowsDB(ctx, db, "SELECT token, payload, expires_at FROM download_tokens WHERE token = "+surrealString(token)+";")
	if err != nil {
		return DownloadToken{}, err
	}
	if len(rows) != 1 {
		return DownloadToken{}, fmt.Errorf("download token not found")
	}
	expiresAt, err := parseTimeField(rows[0]["expires_at"])
	if err != nil {
		return DownloadToken{}, fmt.Errorf("parse download token expiry: %w", err)
	}
	if time.Now().UTC().After(expiresAt) {
		return DownloadToken{}, fmt.Errorf("download token expired")
	}
	payload, ok := rows[0]["payload"].(map[string]any)
	if !ok {
		return DownloadToken{}, fmt.Errorf("download token payload is not an object")
	}
	return DownloadToken{Token: token, Payload: payload, ExpiresAt: expiresAt}, nil
}

func DeleteProject(ctx context.Context, db *persistence.DB, projectID string) error {
	return deleteRecordInTransaction(ctx, db, "projects", projectID)
}

func DeleteTabularReview(ctx context.Context, db *persistence.DB, reviewID string) error {
	return deleteRecordInTransaction(ctx, db, "tabular_reviews", reviewID)
}

func deleteRecordInTransaction(ctx context.Context, db *persistence.DB, table, id string) error {
	return db.Transaction(ctx, func(ctx context.Context, tx *persistence.Tx) error {
		_, err := tx.Query(ctx, "DELETE "+recordID(table, id)+";")
		return err
	})
}

func AppendChatMessages(ctx context.Context, db *persistence.DB, chatID string, messages []ChatMessageWrite) error {
	return db.Transaction(ctx, func(ctx context.Context, tx *persistence.Tx) error {
		for i, message := range messages {
			contentJSON, err := json.Marshal(message.Content)
			if err != nil {
				return err
			}
			filesJSON, err := json.Marshal(message.Files)
			if err != nil {
				return err
			}
			annotationsJSON, err := json.Marshal(message.Annotations)
			if err != nil {
				return err
			}
			// Callers must pass the same ordered slice when retrying; the deterministic
			// row IDs make ordered replays idempotent.
			id := recordID("chat_messages", chatID+"_"+strconv.Itoa(i)+"_"+message.Role)
			_, err = tx.Query(ctx, fmt.Sprintf(`
				UPSERT %s CONTENT {
					chat_id: %s,
					role: %s,
					content: %s,
					files: %s,
					annotations: %s,
					created_at: time::now()
				};
			`, id, recordID("chats", chatID), surrealString(message.Role), string(contentJSON), nullableJSON(filesJSON), nullableJSON(annotationsJSON)))
			if err != nil {
				return err
			}
		}
		return nil
	})
}

type ChatMessageWrite struct {
	Role        string
	Content     any
	Files       []map[string]any
	Annotations []map[string]any
}

func queryRowsDB(ctx context.Context, db *persistence.DB, query string) ([]map[string]any, error) {
	result, err := db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	var statements [][]map[string]any
	if err := json.Unmarshal(result, &statements); err != nil {
		return nil, err
	}
	if len(statements) != 1 {
		return nil, fmt.Errorf("expected one statement result, got %d", len(statements))
	}
	return statements[0], nil
}

func recordID(table, rawID string) string {
	return table + ":" + nonRecordID.ReplaceAllString(rawID, "_")
}

func nullableJSON(data []byte) string {
	if string(data) == "null" {
		return "NONE"
	}
	return string(data)
}

func parseTimeField(value any) (time.Time, error) {
	switch v := value.(type) {
	case string:
		return time.Parse(time.RFC3339Nano, v)
	default:
		return time.Time{}, fmt.Errorf("unsupported datetime value %#v", value)
	}
}
