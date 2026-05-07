package persistence_test

import (
	"path/filepath"
	"testing"

	"github.com/CaliLuke/luke/backend-go/internal/persistence"
)

func TestRustSurrealKVPersistsRecordsAcrossReopen(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "surrealkv")
	if err := persistence.RunSurrealKVSpike(dbPath); err != nil {
		t.Fatal(err)
	}
}
