.PHONY: all build test run run-monitor

# Default target
all: build

# Build the project
build:
	cargo build

# Run tests
test:
	cargo test

# Run the CLI
run:
	cargo run --bin noderr_cli

# Run the trust monitor with default settings
run-monitor:
	@echo "\nNoderr Trust Score Monitor\n"
	@echo "Starting continuous trust monitoring...\n"
	cargo run --bin noderr_cli -- trust-monitor --interval 30

# Run a one-time trust check
trust-check:
	cargo run --bin noderr_cli -- trust-monitor --once 