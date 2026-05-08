package localdata

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/i2y/romancy"

	"github.com/CaliLuke/luke/backend-go/internal/persistence"
)

const (
	DataDirEnv         = "LUKE_DATA_DIR"
	LocalStorageEnv    = "LOCAL_STORAGE_ROOT"
	Namespace          = "luke"
	Database           = "luke"
	SurrealKVDirName   = "surrealkv"
	RomancyDBName      = "romancy.db"
	LocalStorageDir    = "storage"
	singleWriterErrMsg = "another Luke backend appears to be using $LUKE_DATA_DIR"
)

type Options struct {
	DataDir          string
	LocalStorageRoot string
	Workers          int
	WorkerID         string
}

type App struct {
	DataDir          string
	SurrealKVDir     string
	RomancyDBPath    string
	LocalStorageRoot string
	User             UserContext

	DB        *persistence.DB
	Romancy   *romancy.App
	Workflows DocumentWorkflowSet
}

var (
	activeDirsMu sync.Mutex
	activeDirs   = map[string]struct{}{}
)

func Open(ctx context.Context, opts Options) (*App, error) {
	paths, err := resolvePaths(opts)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(paths.dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("create LUKE_DATA_DIR: %w", err)
	}
	if err = os.MkdirAll(paths.localStorageRoot, 0o700); err != nil {
		return nil, fmt.Errorf("create LOCAL_STORAGE_ROOT: %w", err)
	}

	release, err := claimActiveDir(paths.dataDir)
	if err != nil {
		return nil, err
	}
	defer func() {
		if release != nil {
			release()
		}
	}()

	if err = SweepTempFiles(paths.localStorageRoot); err != nil {
		return nil, fmt.Errorf("sweep local storage temp files: %w", err)
	}

	db, err := persistence.Open(paths.surrealKVDir, persistence.Options{Workers: opts.Workers})
	if err != nil {
		return nil, wrapOpenError(err)
	}

	romancyApp := romancy.NewApp(
		romancy.WithDatabase(paths.romancyDBPath),
		romancy.WithWorkerID(workerID(opts.WorkerID)),
		romancy.WithServiceName("luke-local"),
	)
	workflows := RegisterDocumentWorkflows(romancyApp, db, paths.dataDir, paths.localStorageRoot)
	if err := romancyApp.Start(ctx); err != nil {
		clearActiveWorkflowDB(paths.dataDir)
		_ = db.Close(context.Background())
		return nil, fmt.Errorf("start romancy at %s: %w", paths.romancyDBPath, err)
	}

	app := &App{
		DataDir:          paths.dataDir,
		SurrealKVDir:     paths.surrealKVDir,
		RomancyDBPath:    paths.romancyDBPath,
		LocalStorageRoot: paths.localStorageRoot,
		User:             LocalUser(),
		DB:               db,
		Romancy:          romancyApp,
		Workflows:        workflows,
	}
	if initErr := app.initialize(ctx); initErr != nil {
		release = nil
		_ = app.Close(context.Background())
		return nil, initErr
	}

	release = nil
	return app, nil
}

func (app *App) Close(ctx context.Context) error {
	var errs []error
	if app.Romancy != nil {
		if err := app.Romancy.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if app.DB != nil {
		clearActiveWorkflowDB(app.DataDir)
		if err := app.DB.Close(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	releaseActiveDir(app.DataDir)
	return errors.Join(errs...)
}

func (app *App) initialize(ctx context.Context) error {
	if err := initSchema(ctx, app.DB); err != nil {
		return err
	}
	if err := seedLocalUser(ctx, app.DB); err != nil {
		return err
	}
	if err := seedBuiltinWorkflows(ctx, app.DB); err != nil {
		return err
	}
	return nil
}

type resolvedPaths struct {
	dataDir          string
	surrealKVDir     string
	romancyDBPath    string
	localStorageRoot string
}

func resolvePaths(opts Options) (resolvedPaths, error) {
	dataDir := opts.DataDir
	if dataDir == "" {
		dataDir = os.Getenv(DataDirEnv)
	}
	if dataDir == "" {
		return resolvedPaths{}, fmt.Errorf("%s is required", DataDirEnv)
	}
	dataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return resolvedPaths{}, fmt.Errorf("resolve LUKE_DATA_DIR: %w", err)
	}

	localStorageRoot := opts.LocalStorageRoot
	if localStorageRoot == "" {
		localStorageRoot = os.Getenv(LocalStorageEnv)
	}
	if localStorageRoot == "" {
		localStorageRoot = filepath.Join(dataDir, LocalStorageDir)
	}
	localStorageRoot, err = filepath.Abs(localStorageRoot)
	if err != nil {
		return resolvedPaths{}, fmt.Errorf("resolve LOCAL_STORAGE_ROOT: %w", err)
	}

	return resolvedPaths{
		dataDir:          dataDir,
		surrealKVDir:     filepath.Join(dataDir, SurrealKVDirName),
		romancyDBPath:    filepath.Join(dataDir, RomancyDBName),
		localStorageRoot: localStorageRoot,
	}, nil
}

func claimActiveDir(dataDir string) (func(), error) {
	activeDirsMu.Lock()
	defer activeDirsMu.Unlock()
	if _, ok := activeDirs[dataDir]; ok {
		return nil, fmt.Errorf("%s: %s", singleWriterErrMsg, dataDir)
	}
	activeDirs[dataDir] = struct{}{}
	return func() { releaseActiveDir(dataDir) }, nil
}

func releaseActiveDir(dataDir string) {
	activeDirsMu.Lock()
	defer activeDirsMu.Unlock()
	delete(activeDirs, dataDir)
}

func wrapOpenError(err error) error {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "lock") || strings.Contains(message, "resource temporarily unavailable") {
		return fmt.Errorf("%s: %w", singleWriterErrMsg, err)
	}
	return fmt.Errorf("open SurrealKV at $LUKE_DATA_DIR/%s: %w", SurrealKVDirName, err)
}

func workerID(configured string) string {
	if configured != "" {
		return configured
	}
	return "luke-local-worker"
}
