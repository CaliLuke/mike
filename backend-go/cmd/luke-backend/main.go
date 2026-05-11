package main

import (
	"context"
	"errors"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	loomotelhttp "github.com/CaliLuke/loom/http/middleware/otel"
	"go.opentelemetry.io/otel/trace"

	"github.com/CaliLuke/luke/backend-go/internal/localapi"
	"github.com/CaliLuke/luke/backend-go/internal/localdata"
	"github.com/CaliLuke/luke/backend-go/internal/telemetry"
)

// traceContextHandler wraps a slog.Handler so every record carries the
// active span's trace_id / span_id when the caller passed a context. The
// log file then becomes greppable by trace id — pick any chat from the
// telemetry DB and find every slog line that fired during it.
type traceContextHandler struct {
	slog.Handler
}

func (h *traceContextHandler) Handle(ctx context.Context, r slog.Record) error {
	if ctx != nil {
		if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
			r.AddAttrs(
				slog.String("trace_id", sc.TraceID().String()),
				slog.String("span_id", sc.SpanID().String()),
			)
		}
	}
	return h.Handler.Handle(ctx, r)
}

func (h *traceContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &traceContextHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *traceContextHandler) WithGroup(name string) slog.Handler {
	return &traceContextHandler{Handler: h.Handler.WithGroup(name)}
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Mirror slog to a file alongside stderr so a separate observer (e.g. a
	// repro script) can tail it without sharing the air terminal.
	logPath := os.Getenv("LUKE_BACKEND_SLOG_FILE")
	if logPath == "" {
		logPath = "/tmp/luke-backend.log"
	}
	if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		base := slog.NewJSONHandler(io.MultiWriter(os.Stderr, f), &slog.HandlerOptions{Level: slog.LevelInfo})
		slog.SetDefault(slog.New(&traceContextHandler{Handler: base}))
		log.Printf("slog mirroring to %s (with trace_id correlation)", logPath)
	} else {
		log.Printf("slog mirror open failed: %v", err)
	}

	app, err := localdata.Open(ctx, localdata.Options{})
	if err != nil {
		log.Fatalf("open local data: %v", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if closeErr := app.Close(shutdownCtx); closeErr != nil {
			log.Printf("close local data: %v", closeErr)
		}
	}()

	tel, err := telemetry.Init(ctx, filepath.Join(app.DataDir, "telemetry.sqlite"))
	if err != nil {
		log.Printf("telemetry init: %v", err)
	} else if tel != nil {
		log.Printf("telemetry enabled: %s/telemetry.sqlite", app.DataDir)
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := tel.Shutdown(shutdownCtx); err != nil {
				log.Printf("telemetry shutdown: %v", err)
			}
		}()
	}

	addr := localapi.ListenAddr(os.Getenv("LUKE_BACKEND_ADDR"))
	handler := localapi.New(app, tel)
	if tel != nil {
		handler = loomotelhttp.Handler(handler, telemetry.ServiceName)
	}
	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown server: %v", err)
		}
	}()

	log.Printf("Luke local backend listening on http://%s", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
}
