package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/CaliLuke/luke/backend-go/internal/localapi"
	"github.com/CaliLuke/luke/backend-go/internal/localdata"
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

	addr := localapi.ListenAddr(os.Getenv("LUKE_BACKEND_ADDR"))
	server := &http.Server{
		Addr:              addr,
		Handler:           localapi.New(app),
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
