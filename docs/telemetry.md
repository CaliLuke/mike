# OpenTelemetry

Local OTel setup for the Next.js frontend and Go backend. Spans persist to
SQLite for offline querying. On-by-default in dev.

## Architecture

- **Frontend** uses `@opentelemetry/sdk-trace-web` with a custom span exporter
  that POSTs JSON span batches to the Go backend's `/v1/traces` endpoint.
  `FetchInstrumentation` auto-creates spans for `fetch()` calls and injects
  the W3C `traceparent` header so backend spans become children of the
  originating click.
- **Backend** uses loom's OTel runtime (`github.com/CaliLuke/loom/observability/otel`)
  - HTTP middleware (`loom/http/middleware/otel`) to auto-create spans for
    every HTTP request. A custom `SpanProcessor` writes ended spans straight
    to SQLite — no OTLP collector process required.
- **Sink**: `<LUKE_DATA_DIR>/telemetry.sqlite`. Schema in
  `backend-go/internal/telemetry/telemetry.go`.

The browser→backend wire format is a simplified JSON, not OTLP-protobuf.
The OTel API, span IDs, and W3C trace propagation are standard. Swap the
ingest handler for an OTLP receiver if you ever need full standards
compliance.

## Enabling / disabling

- Backend: `OTEL_ENABLED=false` to disable. Default: on.
- Frontend: `NEXT_PUBLIC_OTEL_ENABLED=false` to disable. Default: on in dev,
  off in production builds is not enforced — set the flag explicitly if you
  ship a production frontend bundle.

## Manual instrumentation

### Frontend

```ts
import { getTracer } from "@/app/lib/telemetry";

const span = getTracer().startSpan("checkout.start", {
  attributes: { "cart.id": cartId },
});
try {
  await doThing();
} finally {
  span.end();
}
```

Or wrap with `tracer.startActiveSpan(...)` for proper context propagation
to nested fetches.

### Backend (Go)

```go
import "github.com/CaliLuke/luke/backend-go/internal/telemetry"

ctx, span := telemetry.Tracer("luke-backend").Start(ctx, "tabular.generate")
defer span.End()
```

## Querying

```bash
DB="$LUKE_DATA_DIR/telemetry.sqlite"

# All spans for a single trace, in order
sqlite3 -column -header "$DB" \
  "SELECT name, service, kind, parent_span_id, start_unix_nano
   FROM spans WHERE trace_id = '<TRACE_ID>'
   ORDER BY start_unix_nano"

# Recent frontend nav clicks
sqlite3 "$DB" \
  "SELECT trace_id, name, attributes
   FROM spans WHERE service = 'luke-frontend' AND name = 'nav.click'
   ORDER BY start_unix_nano DESC LIMIT 10"

# Find slow backend spans
sqlite3 "$DB" \
  "SELECT name, (end_unix_nano - start_unix_nano) / 1000000 AS ms
   FROM spans WHERE service = 'luke-backend'
   ORDER BY ms DESC LIMIT 20"
```

## Retention

- Time-based: spans older than 24h are pruned every 10 min.
- Row cap: hard ceiling of 100,000 rows; oldest are dropped above that.
