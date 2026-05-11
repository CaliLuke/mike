package probe

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// TelemetryDB opens the backend's telemetry SQLite file read-only.
// Honours LUKE_DATA_DIR (same env the backend reads) so tests find the same
// DB the live backend is writing to.
type TelemetryDB struct{ db *sql.DB }

func OpenTelemetry() (*TelemetryDB, error) {
	dir := os.Getenv("LUKE_DATA_DIR")
	if dir == "" {
		// air-default location in this repo
		dir = filepath.Join("..", ".tmp", "luke-local", "data")
		if _, err := os.Stat(dir); err != nil {
			// run from repo root
			dir = ".tmp/luke-local/data"
		}
	}
	path := filepath.Join(dir, "telemetry.sqlite")
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("telemetry sqlite not found at %s — is the backend running?", path)
	}
	// mode=ro + immutable so we never block the backend writer.
	dsn := "file:" + path + "?mode=ro&_pragma=busy_timeout(2000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return &TelemetryDB{db: db}, nil
}

func (t *TelemetryDB) Close() error {
	if t == nil || t.db == nil {
		return nil
	}
	return t.db.Close()
}

// Span is the projection of a row that probe assertions care about. Raw
// attributes stay as JSON-decoded map for ad-hoc inspection in custom
// assertions.
type Span struct {
	ID         int64
	Name       string
	Status     string
	StartTime  time.Time
	EndTime    time.Time
	Duration   time.Duration
	Attributes map[string]any
}

// String emits a compact one-line summary suitable for the probe report.
func (s Span) String() string {
	var attrSnippet string
	for _, key := range []string{"tabular.exit_reason", "tabular.row_mode", "tabular.cells.done", "tabular.cells.failed", "tabular.rows.created", "tabular.anchor.exit_reason", "exception.message"} {
		if v, ok := s.Attributes[key]; ok && v != nil {
			attrSnippet = key + "=" + fmt.Sprint(v)
			break
		}
	}
	return fmt.Sprintf("%-32s %-6s %8.1fms %s", s.Name, s.Status, float64(s.Duration.Milliseconds()), attrSnippet)
}

// SpansBetween returns every span whose start_unix_nano falls inside the
// half-open interval [from, to). Most probe assertions then filter that set
// in Go.
func (t *TelemetryDB) SpansBetween(ctx context.Context, from, to time.Time) ([]Span, error) {
	rows, err := t.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(status, ''), start_unix_nano, end_unix_nano, COALESCE(attributes, '')
		FROM spans
		WHERE start_unix_nano >= ? AND start_unix_nano < ?
		ORDER BY start_unix_nano ASC
	`, from.UnixNano(), to.UnixNano())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Span
	for rows.Next() {
		var (
			id      int64
			name    string
			status  string
			start   int64
			end     int64
			attrRaw string
		)
		if err := rows.Scan(&id, &name, &status, &start, &end, &attrRaw); err != nil {
			return nil, err
		}
		s := Span{
			ID:        id,
			Name:      name,
			Status:    status,
			StartTime: time.Unix(0, start),
			EndTime:   time.Unix(0, end),
			Duration:  time.Duration(end - start),
		}
		if attrRaw != "" {
			_ = json.Unmarshal([]byte(attrRaw), &s.Attributes)
		}
		if s.Attributes == nil {
			s.Attributes = map[string]any{}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Filter is a chainable predicate over a span slice. Each method returns a
// fresh slice so callers can branch and reuse.
type Filter struct{ spans []Span }

func From(spans []Span) Filter { return Filter{spans: spans} }
func (f Filter) Spans() []Span { return f.spans }
func (f Filter) Count() int    { return len(f.spans) }

// Named keeps spans whose Name exactly matches.
func (f Filter) Named(name string) Filter {
	out := make([]Span, 0, len(f.spans))
	for _, s := range f.spans {
		if s.Name == name {
			out = append(out, s)
		}
	}
	return Filter{spans: out}
}

// NamePrefix keeps spans whose Name starts with prefix.
func (f Filter) NamePrefix(prefix string) Filter {
	out := make([]Span, 0, len(f.spans))
	for _, s := range f.spans {
		if strings.HasPrefix(s.Name, prefix) {
			out = append(out, s)
		}
	}
	return Filter{spans: out}
}

// WithAttr keeps spans whose Attributes[key] equals (fmt.Sprint) wantValue.
// Use a literal go value matching the JSON shape — strings stay strings;
// numbers will be float64 after JSON decode.
func (f Filter) WithAttr(key string, wantValue any) Filter {
	want := fmt.Sprint(wantValue)
	out := make([]Span, 0, len(f.spans))
	for _, s := range f.spans {
		if v, ok := s.Attributes[key]; ok && fmt.Sprint(v) == want {
			out = append(out, s)
		}
	}
	return Filter{spans: out}
}

// Errors keeps only spans whose Status is "Error" (set by recordSpanError).
func (f Filter) Errors() Filter {
	out := make([]Span, 0, len(f.spans))
	for _, s := range f.spans {
		if s.Status == "Error" {
			out = append(out, s)
		}
	}
	return Filter{spans: out}
}

// Assertion is the result of a single check.
type Assertion struct {
	Description string
	OK          bool
	Detail      string
}

// Require returns an Assertion that fails when the filter is empty. Use for
// "this span must exist" checks.
func (f Filter) Require(description string) Assertion {
	if len(f.spans) == 0 {
		return Assertion{Description: description, OK: false, Detail: "no matching spans"}
	}
	return Assertion{Description: description, OK: true, Detail: fmt.Sprintf("%d span(s)", len(f.spans))}
}

// RequireAtLeast asserts at least n matching spans.
func (f Filter) RequireAtLeast(n int, description string) Assertion {
	if len(f.spans) < n {
		return Assertion{Description: description, OK: false, Detail: fmt.Sprintf("only %d, want ≥%d", len(f.spans), n)}
	}
	return Assertion{Description: description, OK: true, Detail: fmt.Sprintf("%d span(s)", len(f.spans))}
}

// RequireExactly asserts an exact count.
func (f Filter) RequireExactly(n int, description string) Assertion {
	if len(f.spans) != n {
		return Assertion{Description: description, OK: false, Detail: fmt.Sprintf("got %d, want exactly %d", len(f.spans), n)}
	}
	return Assertion{Description: description, OK: true, Detail: fmt.Sprintf("%d span(s)", len(f.spans))}
}

// RequireNone asserts an empty filter. Useful for "no Error spans in window".
func (f Filter) RequireNone(description string) Assertion {
	if len(f.spans) == 0 {
		return Assertion{Description: description, OK: true, Detail: "none"}
	}
	names := make([]string, 0, len(f.spans))
	for _, s := range f.spans {
		names = append(names, s.Name)
		if len(names) >= 5 {
			names = append(names, "…")
			break
		}
	}
	return Assertion{Description: description, OK: false, Detail: fmt.Sprintf("%d unwanted: %s", len(f.spans), strings.Join(names, ", "))}
}

// AggregateAttrSum sums a numeric attribute across all spans in the filter.
// Returns the sum and a bool indicating whether any span carried the key.
func (f Filter) AggregateAttrSum(key string) (float64, bool) {
	var total float64
	any := false
	for _, s := range f.spans {
		if v, ok := s.Attributes[key]; ok {
			switch n := v.(type) {
			case float64:
				total += n
			case int:
				total += float64(n)
			case int64:
				total += float64(n)
			default:
				continue
			}
			any = true
		}
	}
	return total, any
}

// ErrAssertionFailed is returned by ReportFailures when any assertion failed.
var ErrAssertionFailed = errors.New("probe: one or more assertions failed")
