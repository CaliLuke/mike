// Package telemetry bootstraps OpenTelemetry for the local backend using
// loom's observability wrapper, and persists spans to a local SQLite file
// for offline querying. It also exposes an HTTP handler that accepts span
// batches from the browser tracer (W3C trace-context aware).
//
// The wire format used by the browser exporter is a simplified JSON shape
// — not OTLP-protobuf — to keep the desktop bundle small. The OTel API,
// span IDs, and trace propagation are standard; only the transport between
// browser and this receiver is custom. Swap to OTLP later by replacing
// SpanIngestHandler.
package telemetry

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	loomotel "github.com/CaliLuke/loom/observability/otel"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	_ "modernc.org/sqlite"
)

const (
	// EnvVar disables telemetry when set to a falsy value. Default: enabled.
	EnvVar = "OTEL_ENABLED"
	// ServiceName identifies the backend in trace resources.
	ServiceName = "luke-backend"
	// DefaultRetention bounds how far back spans are kept on disk.
	DefaultRetention = 24 * time.Hour
	// MaxRows is the hard ceiling on rows in the spans table.
	MaxRows = 100_000
)

type Telemetry struct {
	runtime   *loomotel.Runtime
	processor *sqliteSpanProcessor
}

// Enabled reports whether telemetry should run. Default is on.
func Enabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(EnvVar)))
	return v != "0" && v != "false" && v != "no" && v != "off"
}

// Init bootstraps the OTel runtime and SQLite span sink. Returns nil
// telemetry when disabled.
func Init(ctx context.Context, dbPath string) (*Telemetry, error) {
	if !Enabled() {
		return nil, nil
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return nil, fmt.Errorf("telemetry: mkdir: %w", err)
	}
	dsn := dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("telemetry: open sqlite: %w", err)
	}
	if _, schemaErr := db.Exec(spanSchema); schemaErr != nil {
		_ = db.Close()
		return nil, fmt.Errorf("telemetry: schema: %w", schemaErr)
	}

	rt, err := loomotel.New(ctx, loomotel.Config{
		ServiceName:    ServiceName,
		ServiceVersion: "dev",
		Environment:    "local",
		Traces:         loomotel.TraceConfig{Enabled: true, SampleRatio: 1},
	})
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("telemetry: loom otel init: %w", err)
	}

	proc := newSQLiteSpanProcessor(db)
	if tp, ok := rt.TracerProvider.(*sdktrace.TracerProvider); ok {
		tp.RegisterSpanProcessor(proc)
	}
	otel.SetTracerProvider(rt.TracerProvider)
	otel.SetTextMapPropagator(rt.Propagators)

	go proc.runRetention(DefaultRetention, MaxRows)

	return &Telemetry{runtime: rt, processor: proc}, nil
}

// Shutdown drains span buffers and closes the database.
func (t *Telemetry) Shutdown(ctx context.Context) error {
	if t == nil {
		return nil
	}
	var errs []string
	if err := t.runtime.Shutdown(ctx); err != nil {
		errs = append(errs, err.Error())
	}
	if err := t.processor.Shutdown(ctx); err != nil {
		errs = append(errs, err.Error())
	}
	if len(errs) > 0 {
		return fmt.Errorf("telemetry shutdown: %s", strings.Join(errs, "; "))
	}
	return nil
}

// SpanIngestHandler returns an HTTP handler that accepts span batches from
// the browser tracer. Body shape:
//
//	{ "spans": [ { trace_id, span_id, parent_span_id, name, kind, service,
//	               start_unix_nano, end_unix_nano, attributes, status } ] }
func (t *Telemetry) SpanIngestHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if t == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		defer func() { _ = r.Body.Close() }()
		var body struct {
			Spans []ingestedSpan `json:"spans"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&body); err != nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		for _, s := range body.Spans {
			t.processor.ingest(s)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type ingestedSpan struct {
	TraceID       string         `json:"trace_id"`
	SpanID        string         `json:"span_id"`
	ParentSpanID  string         `json:"parent_span_id"`
	Name          string         `json:"name"`
	Kind          string         `json:"kind"`
	Service       string         `json:"service"`
	StartUnixNano int64          `json:"start_unix_nano"`
	EndUnixNano   int64          `json:"end_unix_nano"`
	Attributes    map[string]any `json:"attributes"`
	Status        string         `json:"status"`
}

type sqliteSpanProcessor struct {
	db   *sql.DB
	once sync.Once
	done chan struct{}
}

func newSQLiteSpanProcessor(db *sql.DB) *sqliteSpanProcessor {
	return &sqliteSpanProcessor{db: db, done: make(chan struct{})}
}

// OnStart implements sdktrace.SpanProcessor.
func (p *sqliteSpanProcessor) OnStart(_ context.Context, _ sdktrace.ReadWriteSpan) {}

// OnEnd implements sdktrace.SpanProcessor.
func (p *sqliteSpanProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
	sc := s.SpanContext()
	parent := s.Parent()
	parentID := ""
	if parent.HasSpanID() {
		parentID = parent.SpanID().String()
	}
	attrs := attrsToMap(s.Attributes())
	p.write(ingestedSpan{
		TraceID:       sc.TraceID().String(),
		SpanID:        sc.SpanID().String(),
		ParentSpanID:  parentID,
		Name:          s.Name(),
		Kind:          s.SpanKind().String(),
		Service:       ServiceName,
		StartUnixNano: s.StartTime().UnixNano(),
		EndUnixNano:   s.EndTime().UnixNano(),
		Attributes:    attrs,
		Status:        s.Status().Code.String(),
	})
}

func (p *sqliteSpanProcessor) Shutdown(_ context.Context) error {
	p.once.Do(func() { close(p.done) })
	return p.db.Close()
}

func (p *sqliteSpanProcessor) ForceFlush(_ context.Context) error { return nil }

func (p *sqliteSpanProcessor) ingest(s ingestedSpan) {
	if s.TraceID == "" || s.SpanID == "" {
		return
	}
	p.write(s)
}

func (p *sqliteSpanProcessor) write(s ingestedSpan) {
	var attrJSON string
	if len(s.Attributes) > 0 {
		if b, err := json.Marshal(s.Attributes); err == nil {
			attrJSON = string(b)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _ = p.db.ExecContext(ctx, insertSpanSQL,
		s.TraceID, s.SpanID, nullableString(s.ParentSpanID),
		s.Name, s.Kind, s.Service,
		s.StartUnixNano, s.EndUnixNano,
		nullableString(attrJSON), nullableString(s.Status),
	)
}

func (p *sqliteSpanProcessor) runRetention(retention time.Duration, maxRows int) {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-p.done:
			return
		case <-t.C:
			p.prune(retention, maxRows)
		}
	}
}

func (p *sqliteSpanProcessor) prune(retention time.Duration, maxRows int) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cutoff := time.Now().UTC().Add(-retention).UnixNano()
	_, _ = p.db.ExecContext(ctx, "DELETE FROM spans WHERE end_unix_nano < ?", cutoff)
	var n int
	if err := p.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM spans").Scan(&n); err != nil {
		return
	}
	if n > maxRows {
		_, _ = p.db.ExecContext(ctx,
			"DELETE FROM spans WHERE id IN (SELECT id FROM spans ORDER BY id ASC LIMIT ?)",
			n-maxRows)
	}
}

func attrsToMap(kvs []attribute.KeyValue) map[string]any {
	if len(kvs) == 0 {
		return nil
	}
	m := make(map[string]any, len(kvs))
	for _, kv := range kvs {
		m[string(kv.Key)] = kv.Value.AsInterface()
	}
	return m
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

const spanSchema = `
CREATE TABLE IF NOT EXISTS spans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  kind TEXT,
  service TEXT,
  start_unix_nano INTEGER NOT NULL,
  end_unix_nano INTEGER NOT NULL,
  attributes TEXT,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service);
CREATE INDEX IF NOT EXISTS idx_spans_name ON spans(name);
CREATE INDEX IF NOT EXISTS idx_spans_start ON spans(start_unix_nano);
`

const insertSpanSQL = `INSERT INTO spans
(trace_id, span_id, parent_span_id, name, kind, service, start_unix_nano, end_unix_nano, attributes, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
