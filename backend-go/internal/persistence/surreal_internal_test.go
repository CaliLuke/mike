package persistence

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkerCountFromEnv(t *testing.T) {
	t.Setenv(workerEnvName, "")
	if got := workerCountFromEnv(); got != defaultWorkerCount {
		t.Fatalf("empty env worker count = %d, want %d", got, defaultWorkerCount)
	}

	t.Setenv(workerEnvName, "not-a-number")
	if got := workerCountFromEnv(); got != defaultWorkerCount {
		t.Fatalf("invalid env worker count = %d, want %d", got, defaultWorkerCount)
	}

	t.Setenv(workerEnvName, "3")
	if got := workerCountFromEnv(); got != 3 {
		t.Fatalf("configured worker count = %d, want 3", got)
	}
}

func TestClosedHandleErrors(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "surrealkv"), Options{Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(context.Background()); err != nil {
		t.Fatalf("second close returned error: %v", err)
	}

	if _, err := db.Query(context.Background(), "RETURN true;"); !errors.Is(err, errClosed) {
		t.Fatalf("query after close error = %v, want %v", err, errClosed)
	}
	if err := db.Transaction(context.Background(), func(context.Context, *Tx) error {
		return nil
	}); !errors.Is(err, errClosed) {
		t.Fatalf("transaction after close error = %v, want %v", err, errClosed)
	}
}

func TestOpenReturnsErrorForFilePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(path, []byte("not a database directory"), 0o600); err != nil {
		t.Fatal(err)
	}

	db, err := Open(path, Options{Workers: 1})
	if err == nil {
		_ = db.Close(context.Background())
		t.Fatal("expected open to fail for file path")
	}
}
