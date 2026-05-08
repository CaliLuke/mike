package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	loomotelhttp "github.com/CaliLuke/loom/http/middleware/otel"

	"github.com/CaliLuke/luke/backend-go/internal/localapi"
	"github.com/CaliLuke/luke/backend-go/internal/localdata"
	"github.com/CaliLuke/luke/backend-go/internal/telemetry"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app, err := localdata.Open(ctx, localdata.Options{})
	if err != nil {
		log.Fatalf("open local data: %v", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := app.Close(shutdownCtx); err != nil {
			log.Printf("close local data: %v", err)
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
