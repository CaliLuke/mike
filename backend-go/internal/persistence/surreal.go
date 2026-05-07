package persistence

/*
#cgo darwin LDFLAGS: -lluke_surreal_bridge -framework IOKit
#cgo !darwin LDFLAGS: -lluke_surreal_bridge
#include <stdint.h>
#include <stdlib.h>

void *luke_surreal_open(const char *path, char *err_buf, unsigned long err_len);
int luke_surreal_close(void *handle, char *err_buf, unsigned long err_len);
int luke_surreal_query(void *handle, const char *query, char **out_json, char *err_buf, unsigned long err_len);
int luke_surreal_transaction(void *handle, uintptr_t body_id, char *err_buf, unsigned long err_len);
int luke_surreal_tx_query(void *tx, const char *query, char **out_json, char *err_buf, unsigned long err_len);
void luke_surreal_free_string(char *value);
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/alitto/pond"
)

const (
	defaultWorkerCount = 8
	workerEnvName      = "LUKE_SURREALKV_WORKERS"
)

var errClosed = errors.New("surreal persistence handle is closed")
var errTxClosed = errors.New("surreal transaction handle is closed")

type Options struct {
	Workers int
}

type DB struct {
	handle      unsafe.Pointer
	pool        *pond.WorkerPool
	handleMu    sync.Mutex
	lifecycleMu sync.RWMutex
	closed      atomic.Bool
}

type Tx struct {
	ptr    unsafe.Pointer
	active atomic.Bool
}

type txBody struct {
	db  *DB
	ctx context.Context
	fn  func(context.Context, *Tx) error
}

var (
	txBodies     sync.Map
	nextTxBodyID atomic.Uint64
)

func init() {
	// deadcode does not model Rust calling this cgo export.
	keepCgoExport(go_surreal_tx_callback)
}

func keepCgoExport(any) {}

func Open(path string, opts Options) (*DB, error) {
	workers := opts.Workers
	if workers == 0 {
		workers = workerCountFromEnv()
	}
	if workers < 1 {
		workers = defaultWorkerCount
	}

	pool := pond.New(workers, workers)
	db := &DB{pool: pool}
	err := db.run(context.Background(), func() error {
		cPath := C.CString(path)
		defer C.free(unsafe.Pointer(cPath))

		var errBuf cErrorBuffer
		handle := C.luke_surreal_open(cPath, errBuf.ptr(), errBuf.len())
		if handle == nil {
			return fmt.Errorf("open surreal persistence: %s", errBuf.string())
		}
		db.handle = handle
		return nil
	})
	if err != nil {
		pool.StopAndWait()
		return nil, err
	}
	return db, nil
}

func (db *DB) Query(ctx context.Context, query string) (json.RawMessage, error) {
	db.lifecycleMu.RLock()
	defer db.lifecycleMu.RUnlock()

	if db.closed.Load() {
		return nil, errClosed
	}

	var out json.RawMessage
	err := db.run(ctx, func() error {
		db.handleMu.Lock()
		defer db.handleMu.Unlock()

		result, err := queryWithCString(query, "surreal query failed", func(cQuery *C.char, out **C.char, errBuf cErrorBuffer) C.int {
			return C.luke_surreal_query(db.handle, cQuery, out, errBuf.ptr(), errBuf.len())
		})
		if err != nil {
			return err
		}
		out = result
		return nil
	})
	return out, err
}

func (db *DB) Transaction(ctx context.Context, fn func(context.Context, *Tx) error) error {
	db.lifecycleMu.RLock()
	defer db.lifecycleMu.RUnlock()

	if db.closed.Load() {
		return errClosed
	}

	id := nextTxBodyID.Add(1)
	txBodies.Store(id, txBody{db: db, ctx: ctx, fn: fn})
	defer txBodies.Delete(id)

	return db.run(ctx, func() error {
		db.handleMu.Lock()
		defer db.handleMu.Unlock()

		var errBuf cErrorBuffer
		rc := C.luke_surreal_transaction(
			db.handle,
			C.uintptr_t(id),
			errBuf.ptr(),
			errBuf.len(),
		)
		if rc == 0 {
			return nil
		}
		return fmt.Errorf("surreal transaction failed: %s", errBuf.string())
	})
}

func (db *DB) Close(ctx context.Context) error {
	db.lifecycleMu.Lock()
	defer db.lifecycleMu.Unlock()

	if !db.closed.CompareAndSwap(false, true) {
		return nil
	}

	err := db.run(ctx, func() error {
		db.handleMu.Lock()
		defer db.handleMu.Unlock()

		var errBuf cErrorBuffer
		rc := C.luke_surreal_close(db.handle, errBuf.ptr(), errBuf.len())
		db.handle = nil
		if rc == 0 {
			return nil
		}
		return fmt.Errorf("close surreal persistence: %s", errBuf.string())
	})
	db.pool.StopAndWait()
	return err
}

func (tx *Tx) Query(ctx context.Context, query string) (json.RawMessage, error) {
	if !tx.active.Load() {
		return nil, errTxClosed
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return queryWithCString(query, "surreal transaction query failed", func(cQuery *C.char, out **C.char, errBuf cErrorBuffer) C.int {
		return C.luke_surreal_tx_query(tx.ptr, cQuery, out, errBuf.ptr(), errBuf.len())
	})
}

func (db *DB) WorkerStats() WorkerStats {
	return WorkerStats{
		MaxWorkers:      db.pool.MaxWorkers(),
		RunningWorkers:  db.pool.RunningWorkers(),
		WaitingTasks:    db.pool.WaitingTasks(),
		SubmittedTasks:  db.pool.SubmittedTasks(),
		SuccessfulTasks: db.pool.SuccessfulTasks(),
		FailedTasks:     db.pool.FailedTasks(),
	}
}

type WorkerStats struct {
	MaxWorkers      int
	RunningWorkers  int
	WaitingTasks    uint64
	SubmittedTasks  uint64
	SuccessfulTasks uint64
	FailedTasks     uint64
}

func (db *DB) run(ctx context.Context, fn func() error) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	result := make(chan error, 1)
	db.pool.Submit(func() {
		result <- fn()
	})

	return <-result
}

func queryWithCString(
	query string,
	prefix string,
	run func(*C.char, **C.char, cErrorBuffer) C.int,
) (json.RawMessage, error) {
	cQuery := C.CString(query)
	defer C.free(unsafe.Pointer(cQuery))

	var out *C.char
	var errBuf cErrorBuffer
	rc := run(cQuery, &out, errBuf)
	return consumeQueryResult(rc, out, errBuf, prefix)
}

func consumeQueryResult(rc C.int, out *C.char, errBuf cErrorBuffer, prefix string) (json.RawMessage, error) {
	if out != nil {
		defer C.luke_surreal_free_string(out)
	}
	if rc != 0 {
		return nil, fmt.Errorf("%s: %s", prefix, errBuf.string())
	}
	return json.RawMessage(C.GoString(out)), nil
}

func workerCountFromEnv() int {
	value := os.Getenv(workerEnvName)
	if value == "" {
		return defaultWorkerCount
	}
	workers, err := strconv.Atoi(value)
	if err != nil || workers < 1 {
		return defaultWorkerCount
	}
	return workers
}

type cErrorBuffer struct {
	buf [4096]C.char
}

func (b *cErrorBuffer) ptr() *C.char {
	return &b.buf[0]
}

func (b *cErrorBuffer) len() C.ulong {
	return C.ulong(len(b.buf))
}

func (b *cErrorBuffer) string() string {
	return C.GoString(&b.buf[0])
}

func RunSurrealKVSpike(path string) error {
	db, err := Open(path, Options{})
	if err != nil {
		return err
	}
	if _, queryErr := db.Query(context.Background(), `
		DEFINE TABLE spike_project SCHEMALESS;
		UPSERT spike_project:first CONTENT {
			name: "Initial application",
			status: "draft",
			tags: ["local", "surrealkv"]
		};
		UPDATE spike_project:first MERGE { status: "submitted" };
	`); queryErr != nil {
		return queryErr
	}
	if closeErr := db.Close(context.Background()); closeErr != nil {
		return closeErr
	}

	reopened, err := Open(path, Options{})
	if err != nil {
		return err
	}

	result, err := reopened.Query(context.Background(), "SELECT name, status, tags FROM spike_project:first;")
	if err != nil {
		_ = reopened.Close(context.Background())
		return err
	}
	if !json.Valid(result) {
		_ = reopened.Close(context.Background())
		return fmt.Errorf("invalid query JSON: %s", result)
	}

	if _, err := reopened.Query(context.Background(), "DELETE spike_project:first;"); err != nil {
		_ = reopened.Close(context.Background())
		return err
	}
	return reopened.Close(context.Background())
}

//export go_surreal_tx_callback
func go_surreal_tx_callback(tx unsafe.Pointer, bodyID C.uintptr_t, errBuf *C.char, errLen C.ulong) C.int {
	bodyValue, ok := txBodies.Load(uint64(bodyID))
	if !ok {
		writeCError(errBuf, errLen, "transaction callback body missing")
		return 1
	}
	body, ok := bodyValue.(txBody)
	if !ok {
		writeCError(errBuf, errLen, "transaction callback body has unexpected type")
		return 1
	}
	if err := body.ctx.Err(); err != nil {
		writeCError(errBuf, errLen, err.Error())
		return 1
	}
	txHandle := &Tx{ptr: tx}
	txHandle.active.Store(true)
	defer txHandle.active.Store(false)
	err := body.fn(body.ctx, txHandle)
	if err != nil {
		writeCError(errBuf, errLen, err.Error())
		return 1
	}
	if err := body.ctx.Err(); err != nil {
		writeCError(errBuf, errLen, err.Error())
		return 1
	}
	return 0
}

func writeCError(errBuf *C.char, errLen C.ulong, message string) {
	if errBuf == nil || errLen == 0 {
		return
	}
	bytes := []byte(message)
	buf := unsafe.Slice((*byte)(unsafe.Pointer(errBuf)), int(errLen))
	max := len(buf) - 1
	if len(bytes) > max {
		bytes = bytes[:max]
	}
	copy(buf, bytes)
	buf[len(bytes)] = 0
}
