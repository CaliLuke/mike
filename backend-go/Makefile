RUST_BRIDGE_DIR = internal/persistence/rustbridge
RUST_BRIDGE_LIB = $(RUST_BRIDGE_DIR)/target/release/libluke_surreal_bridge.a
RUST_BRIDGE_TARGET_STAMP = $(RUST_BRIDGE_DIR)/target/release/.luke-macosx-deployment-target

export CGO_LDFLAGS := -L$(CURDIR)/$(RUST_BRIDGE_DIR)/target/release

ifeq ($(shell uname -s),Darwin)
  export MACOSX_DEPLOYMENT_TARGET ?= $(shell xcrun --sdk macosx --show-sdk-platform-version 2>/dev/null || sw_vers -productVersion | awk -F. '{ print $$1 "." $$2 }')
  ifneq (,$(wildcard /Library/Developer/CommandLineTools/usr/bin/clang))
    export CC := /Library/Developer/CommandLineTools/usr/bin/clang
  endif
  ifneq (,$(wildcard /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/lib))
    export SDKROOT := /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk
  endif
endif

.PHONY: test check tools clean

$(RUST_BRIDGE_LIB): $(RUST_BRIDGE_TARGET_STAMP)

$(RUST_BRIDGE_TARGET_STAMP): $(RUST_BRIDGE_DIR)/Cargo.toml $(RUST_BRIDGE_DIR)/src/lib.rs
	if [ "$$(cat $(RUST_BRIDGE_TARGET_STAMP) 2>/dev/null || true)" != "$(MACOSX_DEPLOYMENT_TARGET)" ]; then cd $(RUST_BRIDGE_DIR) && cargo clean; fi
	cd $(RUST_BRIDGE_DIR) && cargo build --release
	printf '%s\n' "$(MACOSX_DEPLOYMENT_TARGET)" > $(RUST_BRIDGE_TARGET_STAMP)

test: $(RUST_BRIDGE_LIB)
	go test ./...

check:
	./check.sh

tools:
	go list -tags=tools -f '{{range .Imports}}{{.}}{{"\n"}}{{end}}' . | xargs -n1 go install

clean:
	rm -rf $(RUST_BRIDGE_DIR)/target

# Probe runner — drives end-to-end scenarios against the running backend
# (default LUKE_BACKEND_ADDR=127.0.0.1:3002) and asserts outcomes from
# telemetry.sqlite. Used by the claude-code agent for autonomous test loops.
.PHONY: probe probe-list probe-build

probe-build: $(RUST_BRIDGE_LIB)
	go build -o ../.tmp/probe ./cmd/probe

probe-list: probe-build
	../.tmp/probe list

# Run a scenario:  make probe SCENARIO=accomplishments
probe: probe-build
	@if [ -z "$(SCENARIO)" ]; then \
		echo "usage: make probe SCENARIO=<name>  (try: make probe-list)"; \
		exit 2; \
	fi
	../.tmp/probe run $(SCENARIO)
