package probe

import (
	"fmt"
	"io"
	"strings"
	"time"
)

// Result captures everything one scenario run produced. The runner prints it
// at the end; the binary's exit code is 0 iff every assertion passed.
type Result struct {
	Scenario    string
	StartedAt   time.Time
	EndedAt     time.Time
	Assertions  []Assertion
	SSESummary  map[string]int // event-type -> count
	SpansAll    []Span         // every span in the run window, in start order
	Notes       []string       // free-form lines the scenario added
	SetupErrors []string
}

func (r *Result) AddAssertion(a Assertion) { r.Assertions = append(r.Assertions, a) }
func (r *Result) AddNote(format string, args ...any) {
	r.Notes = append(r.Notes, fmt.Sprintf(format, args...))
}
func (r *Result) RecordSetupError(err error) {
	if err == nil {
		return
	}
	r.SetupErrors = append(r.SetupErrors, err.Error())
}

// Passed reports whether every assertion is OK and no setup error fired.
func (r *Result) Passed() bool {
	if len(r.SetupErrors) > 0 {
		return false
	}
	for _, a := range r.Assertions {
		if !a.OK {
			return false
		}
	}
	return len(r.Assertions) > 0
}

// Write prints a human-readable report. The format is deliberately scannable
// in a terminal scrollback: a status line, the assertion list, the SSE event
// counts, and a span table truncated to the most interesting spans.
func (r *Result) Write(w io.Writer) {
	dur := r.EndedAt.Sub(r.StartedAt)
	status := "FAIL"
	if r.Passed() {
		status = "PASS"
	}
	_, _ = fmt.Fprintf(w, "\n=== probe: %s — %s (%.1fs) ===\n", r.Scenario, status, dur.Seconds())

	if len(r.SetupErrors) > 0 {
		_, _ = fmt.Fprintln(w, "\nSetup errors:")
		for _, e := range r.SetupErrors {
			_, _ = fmt.Fprintf(w, "  ✗ %s\n", e)
		}
	}

	if len(r.Assertions) > 0 {
		_, _ = fmt.Fprintln(w, "\nAssertions:")
		for _, a := range r.Assertions {
			mark := "✓"
			if !a.OK {
				mark = "✗"
			}
			_, _ = fmt.Fprintf(w, "  %s %s — %s\n", mark, a.Description, a.Detail)
		}
	}

	if len(r.SSESummary) > 0 {
		_, _ = fmt.Fprintln(w, "\nSSE events:")
		for k, v := range r.SSESummary {
			_, _ = fmt.Fprintf(w, "  %-30s %d\n", k, v)
		}
	}

	if len(r.Notes) > 0 {
		_, _ = fmt.Fprintln(w, "\nNotes:")
		for _, n := range r.Notes {
			_, _ = fmt.Fprintf(w, "  · %s\n", n)
		}
	}

	if len(r.SpansAll) > 0 {
		interesting := pickInterestingSpans(r.SpansAll)
		_, _ = fmt.Fprintf(w, "\nSpans (%d total, showing %d):\n", len(r.SpansAll), len(interesting))
		for _, s := range interesting {
			_, _ = fmt.Fprintf(w, "  %s\n", s.String())
		}
	}

	_, _ = fmt.Fprintln(w)
}

// pickInterestingSpans trims the span list to errors + tabular.* + chatv2.* +
// surreal.tx_query (anything else is usually background noise from polling).
func pickInterestingSpans(spans []Span) []Span {
	out := make([]Span, 0, len(spans))
	for _, s := range spans {
		if s.Status == "Error" ||
			strings.HasPrefix(s.Name, "tabular.") ||
			strings.HasPrefix(s.Name, "chatv2.") ||
			strings.HasPrefix(s.Name, "assistant.") ||
			s.Name == "surreal.tx_query" {
			out = append(out, s)
		}
	}
	return out
}
