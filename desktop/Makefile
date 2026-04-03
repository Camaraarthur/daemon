.PHONY: dev build build-windows build-release clean

# Development build (Linux)
dev:
	cargo build

# Debug build (Linux)
build:
	cargo build

# Windows cross-compilation (debug)
build-windows:
	cargo xwin build --target x86_64-pc-windows-msvc

# Release builds
build-release:
	cargo build --release

build-release-windows:
	cargo xwin build --release --target x86_64-pc-windows-msvc

# Bundle installers (requires tauri-cli)
bundle:
	cargo install tauri-cli --version "^2" || true
	cargo tauri build

bundle-windows:
	cargo install tauri-cli --version "^2" || true
	cargo tauri build --target x86_64-pc-windows-msvc

# Clean
clean:
	cargo clean
