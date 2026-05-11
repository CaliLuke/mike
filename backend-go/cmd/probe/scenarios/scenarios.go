// Package scenarios registers the probe scenarios available to cmd/probe.
// Each scenario is a self-contained end-to-end exercise: setup → drive →
// assert → cleanup. New scenarios call Register from an init().
package scenarios

import (
	"context"

	"github.com/CaliLuke/luke/backend-go/internal/probe"
)

// Scenario is one named end-to-end exercise.
type Scenario struct {
	Name        string
	Description string
	Run         func(ctx context.Context, client *probe.Client, tel *probe.TelemetryDB, result *probe.Result) error
}

var registry = map[string]Scenario{}

// Register adds a scenario. Call from package-level init in a scenario file.
func Register(s Scenario) {
	if s.Name == "" {
		panic("probe scenario: missing name")
	}
	if _, dup := registry[s.Name]; dup {
		panic("probe scenario: duplicate name " + s.Name)
	}
	registry[s.Name] = s
}

func Get(name string) (Scenario, bool) {
	s, ok := registry[name]
	return s, ok
}

func All() map[string]Scenario {
	out := make(map[string]Scenario, len(registry))
	for k, v := range registry {
		out[k] = v
	}
	return out
}
