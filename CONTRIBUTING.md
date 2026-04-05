# Contributing to Daemon

Thanks for your interest in contributing to Daemon. This document covers everything you need to get started.

## Philosophy

Daemon has a clear scope. Before contributing, understand what we will and will not accept:

**Yes:**
- Bug fixes
- Performance improvements
- Better error messages
- New MCP tool integrations
- Multi-device reliability improvements
- Documentation improvements
- Test coverage

**No:**
- Billing, payments, or subscription logic (not in v0)
- Voice, personality, or character features
- Skills marketplace or plugin registry
- Hardware/IoT integrations (ESP32, pendant, etc.)
- Features that add complexity without clear user value

Read [SPEC.md](SPEC.md) Section 1 ("What Daemon is NOT") before proposing new features.

## Development Setup

### Prerequisites

- Node.js 20+
- SQLite
- Git

### Getting started

```bash
git clone https://github.com/arthurcamara/daemon.git
cd daemon

# Web UI and API server
cd web
npm install
npm run dev          # Starts dev server on :4802

# CLI bridge (for testing device pairing)
cd cli
npm install
node daemon.mjs pair <CODE>

# Android (requires Android Studio)
cd android
./gradlew assembleRelease --no-daemon

# Desktop (requires Rust toolchain)
cd desktop
cargo build
```

### Running tests

```bash
# TypeScript type check + build
cd web && npm run build

# Chat quality tests
./scripts/test-chat.sh

# Pre-commit hooks (runs automatically on commit)
.githooks/pre-commit
```

## Code Style

- **TypeScript**: Strict mode. No `any` types unless absolutely necessary.
- **CSS**: Tailwind utility classes. No custom CSS files unless unavoidable.
- **Components**: Functional React components only. No class components.
- **Naming**: `camelCase` for variables/functions, `PascalCase` for components/types, `kebab-case` for files.
- **Imports**: No circular imports. `cli/` and `desktop/` must not import from `web/src/` -- use `protocol/types.ts` as the shared contract.
- **No unnecessary abstractions**: Prefer simple, direct code over clever patterns. If a function is only used once, inline it.

## Pull Request Guidelines

1. **One concern per PR.** Don't mix a bug fix with a feature addition.
2. **Reference SPEC.md.** If your change relates to a spec section, mention it.
3. **Run the build.** `cd web && npm run build` must pass with no errors.
4. **Pre-commit hooks must pass.** These check for secrets and TypeScript errors.
5. **Test your changes.** If you changed chat behavior, run `./scripts/test-chat.sh`. If you changed the UI, test on mobile viewport too.
6. **Write a clear description.** Explain what changed, why, and how to test it.

## Architecture

The codebase is a monorepo. Key directories:

```
web/          Next.js web UI + API server
cli/          Cross-platform CLI device bridge
android/      Native Android app
desktop/      Tauri/Rust desktop bridge
protocol/     Shared protocol types
scripts/      Dev tooling and build scripts
docs/         Architecture docs and research
```

Important files to know:
- `web/src/lib/agent-loop.ts` -- The AI agent's tool execution loop
- `web/src/lib/model-router.ts` -- Routes requests to the right model based on user tier
- `web/src/lib/db.ts` -- Database access layer with migrations
- `web/ws-server.js` -- WebSocket server for device connections
- `protocol/types.ts` -- The shared protocol contract

See [CLAUDE.md](CLAUDE.md) for the full list of key files and development rules.

## Security

**Do not open GitHub issues for security vulnerabilities.**

If you discover a security issue, please report it via email to **security@daemon.page**. We will respond within 48 hours and work with you on a fix before any public disclosure.

Security-sensitive areas:
- Command execution (`agent-loop.ts`, `safety-check.ts`)
- Authentication (`auth.ts`, session management)
- Input sanitization (`sanitize.ts`)
- WebSocket device connections (`ws-server.js`)
- API key storage and handling

## License

By contributing to Daemon, you agree that your contributions will be licensed under the [MIT License](LICENSE).
