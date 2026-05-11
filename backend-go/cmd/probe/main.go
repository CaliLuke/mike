// probe runs end-to-end scenarios against a running Luke backend and asserts
// outcomes from telemetry and the live API. It is the autonomous-loop tool
// the claude-code agent uses while iterating on features: drive the API the
// same way a user would, then compare spans + DB state to expectations.
//
// Usage:
//
//	probe list                  # show available scenarios
//	probe run <scenario>        # run one scenario, exit 0 if assertions pass
//
// Environment:
//
//	LUKE_BACKEND_ADDR=127.0.0.1:3002   (default; same env the backend reads)
//	LUKE_DATA_DIR=…/luke-local/data    (default; same env the backend reads)
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/CaliLuke/luke/backend-go/cmd/probe/scenarios"
	"github.com/CaliLuke/luke/backend-go/internal/probe"
)

func main() {
	if len(os.Args) < 2 {
		usageAndExit()
	}
	switch os.Args[1] {
	case "list":
		cmdList()
	case "run":
		if len(os.Args) < 3 {
			usageAndExit()
		}
		cmdRun(os.Args[2])
	case "-h", "--help", "help":
		usageAndExit()
	default:
		fmt.Fprintf(os.Stderr, "probe: unknown command %q\n", os.Args[1])
		usageAndExit()
	}
}

func usageAndExit() {
	fmt.Fprintln(os.Stderr, "usage:")
	fmt.Fprintln(os.Stderr, "  probe list")
	fmt.Fprintln(os.Stderr, "  probe run <scenario>")
	os.Exit(2)
}

func cmdList() {
	all := scenarios.All()
	names := make([]string, 0, len(all))
	for name := range all {
		names = append(names, name)
	}
	sort.Strings(names)
	fmt.Println("Scenarios:")
	for _, n := range names {
		fmt.Printf("  %-32s %s\n", n, all[n].Description)
	}
}

func cmdRun(name string) {
	scn, ok := scenarios.Get(name)
	if !ok {
		fmt.Fprintf(os.Stderr, "probe: no scenario named %q (use `probe list`)\n", name)
		os.Exit(2)
	}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		c := make(chan os.Signal, 1)
		signal.Notify(c, os.Interrupt, syscall.SIGTERM)
		<-c
		cancel()
	}()

	startedAt := time.Now()
	result := &probe.Result{
		Scenario:   name,
		StartedAt:  startedAt,
		SSESummary: map[string]int{},
	}

	client := probe.NewClient()
	tel, err := probe.OpenTelemetry()
	if err != nil {
		result.RecordSetupError(err)
		result.EndedAt = time.Now()
		result.Write(os.Stdout)
		os.Exit(1)
	}
	defer func() { _ = tel.Close() }()

	if err := scn.Run(ctx, client, tel, result); err != nil {
		result.AddNote("scenario error: %v", err)
	}
	result.EndedAt = time.Now()

	// Capture every span in the run window so the report can show context
	// even on success.
	if spans, err := tel.SpansBetween(ctx, startedAt, result.EndedAt); err == nil {
		result.SpansAll = spans
	} else {
		result.AddNote("telemetry read failed: %v", err)
	}

	result.Write(os.Stdout)
	if !result.Passed() {
		os.Exit(1)
	}
}
