# Security policy

## Reporting a vulnerability

Email **daemon@daemon.page** with:

- A description of the issue and its impact.
- Steps to reproduce (or a proof-of-concept).
- The affected version / commit SHA.
- Whether you're OK with public credit once a fix ships.

Please do **not** file public GitHub issues for security problems. We'll
acknowledge within 72 hours and aim to ship a fix (or a mitigation) within
14 days for high-severity issues.

A public bug bounty program will open once daemon is past v1. For now,
we credit reporters in the release notes of the fix.

## Supported versions

During pre-1.0, only the latest tagged release on `main` receives
security fixes. Once 1.0 ships, we will support the current major + the
previous major for 12 months.

## Release integrity

Every daemon release is reproducibly built and signed. **Verify before
running** — see [`docs/REPRODUCIBLE_BUILDS.md`](docs/REPRODUCIBLE_BUILDS.md)
for the exact command (one line with `gh attestation verify`, or one
`cosign verify-blob` invocation).

Do not install unverified release artifacts. If verification ever fails
on a real release, treat it as a security incident and email the address
above.

## Scope

In scope:

- The daemon CLI (`cli/daemon.mjs`) and its dependencies.
- The relay (`server/`, `deploy/`).
- The web UI (`web/`) including auth, sandboxing, and the agent loop.
- The protocol (`protocol/types.ts`) — cryptographic or logic flaws in
  pairing, routing, or gossip.
- The release pipeline (`.github/workflows/release.yml`) — anything that
  could let an attacker produce a valid signature on a malicious artifact.

Out of scope (for now):

- The Android app (under heavy development, will be added at v1).
- The Tauri desktop app (under heavy development, will be added at v1).
- Hardware (PCB, firmware) — separate threat model, see `THREAT_MODEL.md`.
- Social engineering of maintainers.
- Denial-of-service via resource exhaustion on the public relay.

## Hall of fame

(Empty — be the first.)
