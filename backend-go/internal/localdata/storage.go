package localdata

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const tempFilePrefix = ".tmp-luke-"

func WriteLocalFileAtomic(root, relativePath string, data []byte) error {
	finalPath, err := safeLocalPath(root, relativePath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o700); err != nil {
		return fmt.Errorf("create local storage directory: %w", err)
	}
	tmpPath := filepath.Join(filepath.Dir(finalPath), tempFilePrefix+filepath.Base(finalPath))
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return fmt.Errorf("write local storage temp file: %w", err)
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename local storage temp file: %w", err)
	}
	return nil
}

func ReadLocalFile(root, relativePath string) ([]byte, error) {
	path, err := safeLocalPath(root, relativePath)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(path)
}

func SweepTempFiles(root string) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), tempFilePrefix) {
			return nil
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	})
}

func safeLocalPath(root, relativePath string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("local storage root is required")
	}
	if relativePath == "" {
		return "", fmt.Errorf("local storage path is required")
	}
	if filepath.IsAbs(relativePath) {
		return "", fmt.Errorf("local storage path must be relative")
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve local storage root: %w", err)
	}
	rootReal, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", fmt.Errorf("resolve local storage root symlinks: %w", err)
	}
	pathAbs := filepath.Clean(filepath.Join(rootReal, relativePath))
	if pathAbs != rootReal && !strings.HasPrefix(pathAbs, rootReal+string(os.PathSeparator)) {
		return "", fmt.Errorf("local storage path escapes root")
	}
	if err := rejectSymlinkComponents(rootReal, pathAbs); err != nil {
		return "", err
	}
	return pathAbs, nil
}

func rejectSymlinkComponents(root, path string) error {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return fmt.Errorf("resolve local storage relative path: %w", err)
	}
	current := root
	for part := range strings.SplitSeq(rel, string(os.PathSeparator)) {
		if part == "." || part == "" {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("inspect local storage path: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("local storage path must not contain symlinks")
		}
	}
	return nil
}

func randomToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
