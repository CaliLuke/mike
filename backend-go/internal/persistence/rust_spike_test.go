package persistence_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/CaliLuke/luke/backend-go/internal/persistence"
)

func TestRustSurrealKVPersistsRecordsAcrossReopen(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "surrealkv")
	if err := persistence.RunSurrealKVSpike(dbPath); err != nil {
		t.Fatal(err)
	}
}

func TestSurrealKVTransactionRollback(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "surrealkv")
	db := openTestDB(t, dbPath)
	defer closeTestDB(t, db)

	if _, err := db.Query(ctx, "DEFINE TABLE tx_project SCHEMALESS;"); err != nil {
		t.Fatal(err)
	}

	rollbackErr := errors.New("force rollback")
	err := db.Transaction(ctx, func(ctx context.Context, tx *persistence.Tx) error {
		if _, err := tx.Query(ctx, `
			CREATE tx_project:rollback_one SET name = "rollback one";
			CREATE tx_project:rollback_two SET name = "rollback two";
		`); err != nil {
			return err
		}
		return rollbackErr
	})
	if err == nil || !strings.Contains(err.Error(), rollbackErr.Error()) {
		t.Fatalf("expected rollback error, got %v", err)
	}

	rows := queryRows(t, db, "SELECT * FROM tx_project;")
	if len(rows) != 0 {
		t.Fatalf("rollback persisted rows: %#v", rows)
	}
}

func TestSurrealKVTransactionCommitPersistsAcrossReopen(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "surrealkv")
	db := openTestDB(t, dbPath)

	if err := db.Transaction(ctx, func(ctx context.Context, tx *persistence.Tx) error {
		_, err := tx.Query(ctx, `
			DEFINE TABLE tx_project SCHEMALESS;
			CREATE tx_project:commit_one SET name = "commit one";
			CREATE tx_project:commit_two SET name = "commit two";
		`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	closeTestDB(t, db)

	reopened := openTestDB(t, dbPath)
	defer closeTestDB(t, reopened)

	rows := queryRows(t, reopened, "SELECT * FROM tx_project ORDER BY name;")
	if len(rows) != 2 {
		t.Fatalf("expected 2 committed rows, got %d: %#v", len(rows), rows)
	}
	if rows[0]["name"] != "commit one" || rows[1]["name"] != "commit two" {
		t.Fatalf("unexpected committed rows: %#v", rows)
	}
}

func TestSurrealKVTransactionRollsBackWhenContextCanceled(t *testing.T) {
	db := openTestDB(t, filepath.Join(t.TempDir(), "surrealkv"))
	defer closeTestDB(t, db)
	if _, err := db.Query(context.Background(), "DEFINE TABLE tx_project SCHEMALESS;"); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	err := db.Transaction(ctx, func(ctx context.Context, tx *persistence.Tx) error {
		if _, err := tx.Query(ctx, `CREATE tx_project:canceled SET name = "canceled";`); err != nil {
			return err
		}
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) && (err == nil || !strings.Contains(err.Error(), context.Canceled.Error())) {
		t.Fatalf("expected context cancellation error, got %v", err)
	}

	rows := queryRows(t, db, "SELECT * FROM tx_project;")
	if len(rows) != 0 {
		t.Fatalf("canceled transaction persisted rows: %#v", rows)
	}
}

func TestSurrealKVTransactionHandleCannotEscape(t *testing.T) {
	db := openTestDB(t, filepath.Join(t.TempDir(), "surrealkv"))
	defer closeTestDB(t, db)

	var escaped *persistence.Tx
	if err := db.Transaction(context.Background(), func(ctx context.Context, tx *persistence.Tx) error {
		escaped = tx
		_, err := tx.Query(ctx, "RETURN true;")
		return err
	}); err != nil {
		t.Fatal(err)
	}

	if _, err := escaped.Query(context.Background(), "RETURN true;"); err == nil {
		t.Fatal("expected escaped transaction handle to fail after transaction completion")
	}
}

func TestSurrealKVCloseWaitsForAdmittedQueries(t *testing.T) {
	ctx := context.Background()
	db := openTestDBWithOptions(t, filepath.Join(t.TempDir(), "surrealkv"), persistence.Options{Workers: 8})

	if _, err := db.Query(ctx, "DEFINE TABLE concurrent_project SCHEMALESS;"); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for i := range 16 {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := db.Query(ctx, `CREATE concurrent_project CONTENT { index: `+string(rune('0'+i%10))+` };`)
			errs <- err
		}(i)
	}

	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent admitted query failed before close: %v", err)
		}
	}
	closeTestDB(t, db)
}

func TestSurrealKVWorkerPoolUsesConfiguredSize(t *testing.T) {
	db := openTestDBWithOptions(t, filepath.Join(t.TempDir(), "surrealkv"), persistence.Options{Workers: 2})
	defer closeTestDB(t, db)

	stats := db.WorkerStats()
	if stats.MaxWorkers != 2 {
		t.Fatalf("expected 2 workers, got %d", stats.MaxWorkers)
	}
}

func openTestDB(t *testing.T, path string) *persistence.DB {
	t.Helper()
	return openTestDBWithOptions(t, path, persistence.Options{})
}

func openTestDBWithOptions(t *testing.T, path string, opts persistence.Options) *persistence.DB {
	t.Helper()
	db, err := persistence.Open(path, opts)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func closeTestDB(t *testing.T, db *persistence.DB) {
	t.Helper()
	if err := db.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func queryRows(t *testing.T, db *persistence.DB, query string) []map[string]any {
	t.Helper()
	result, err := db.Query(context.Background(), query)
	if err != nil {
		t.Fatal(err)
	}
	var statements [][]map[string]any
	if err := json.Unmarshal(result, &statements); err != nil {
		t.Fatalf("decode query result %s: %v", result, err)
	}
	if len(statements) != 1 {
		t.Fatalf("expected one statement result, got %d: %s", len(statements), result)
	}
	return statements[0]
}
