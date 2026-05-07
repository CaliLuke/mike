RUST_BRIDGE_DIR = internal/persistence/rustbridge
RUST_BRIDGE_LIB = $(RUST_BRIDGE_DIR)/target/release/libluke_surreal_bridge.a

export CGO_LDFLAGS := -L$(CURDIR)/$(RUST_BRIDGE_DIR)/target/release

ifeq ($(shell uname -s),Darwin)
  ifneq (,$(wildcard /Library/Developer/CommandLineTools/usr/bin/clang))
    export CC := /Library/Developer/CommandLineTools/usr/bin/clang
  endif
  ifneq (,$(wildcard /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/lib))
    export SDKROOT := /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk
  endif
endif

.PHONY: test check tools clean

$(RUST_BRIDGE_LIB): $(RUST_BRIDGE_DIR)/Cargo.toml $(RUST_BRIDGE_DIR)/src/lib.rs
	cd $(RUST_BRIDGE_DIR) && cargo build --release

test: $(RUST_BRIDGE_LIB)
	go test ./...

check:
	./check.sh

tools:
	go list -tags=tools -f '{{range .Imports}}{{.}}{{"\n"}}{{end}}' . | xargs -n1 go install

clean:
	rm -rf $(RUST_BRIDGE_DIR)/target
