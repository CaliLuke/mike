//go:build tools

package tools

import (
	_ "github.com/air-verse/air"
	_ "github.com/alitto/pond"
	_ "github.com/fzipp/gocyclo/cmd/gocyclo"
	_ "github.com/golangci/golangci-lint/v2/cmd/golangci-lint"
	_ "github.com/i2y/romancy"
	_ "github.com/mibk/dupl"
	_ "golang.org/x/tools/cmd/deadcode"
	_ "golang.org/x/tools/cmd/goimports"
	_ "golang.org/x/vuln/cmd/govulncheck"
)
