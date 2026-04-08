# Reproducible builds & release verification

> Status: active as of v0.1 (April 2026). See architecture.md §11.

Daemon releases are **reproducibly built** and **cryptographically signed**.
This page tells you what that means, what it protects you from, and exactly
which command to run before installing a release.

---

## TL;DR — how do I verify a release?

Pick **one** of the two paths. Either is sufficient.

### Path A — GitHub Artifact Attestations (easiest)

Requires `gh` ≥ 2.49 (GitHub CLI).

```bash
gh release download v0.1.0 --repo Camaraarthur/daemon --pattern 'daemon-cli-*.tar.gz'
gh attestation verify daemon-cli-0.1.0.tar.gz --repo Camaraarthur/daemon
```

The verifier will print the workflow file, the commit SHA, and the builder
that produced the artifact. If the artifact was tampered with or built by
anything other than `.github/workflows/release.yml` on the `Camaraarthur/daemon`
repo, the command exits non-zero.

### Path B — cosign (no GitHub CLI needed)

Requires `cosign` ≥ 2.4 from <https://github.com/sigstore/cosign/releases>.

```bash
VERSION=0.1.0
BASE="https://github.com/Camaraarthur/daemon/releases/download/v${VERSION}"

curl -LO "${BASE}/daemon-cli-${VERSION}.tar.gz"
curl -LO "${BASE}/daemon-cli-${VERSION}.tar.gz.cosign.bundle"

cosign verify-blob \
  --bundle "daemon-cli-${VERSION}.tar.gz.cosign.bundle" \
  --certificate-identity-regexp 'https://github\.com/Camaraarthur/daemon/\.github/workflows/release\.yml@refs/tags/v.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "daemon-cli-${VERSION}.tar.gz"
```

Expected output: `Verified OK`. Anything else — stop and open an issue.

---

## Why we do this

The daemon CLI and relay run with access to your devices, your shell, your
files. You should not have to trust that "the tarball I downloaded from
daemon.page is the same code that's on GitHub." You should be able to
**prove** it, mechanically, in one command.

Concretely, verified artifacts give you three guarantees:

1. **Provenance.** The binary was built by our public CI workflow
   (`.github/workflows/release.yml`) on a specific commit of this repo.
2. **Integrity.** The bytes you downloaded are the bytes CI produced. No
   man-in-the-middle, no compromised mirror, no swapped release asset.
3. **Reproducibility.** You (or anyone) can re-run the build from source
   and get the **same** bytes, so "did Arthur sneak something in between
   `git push` and the release?" is answerable by running the build yourself.

---

## Rebuilding from source (reproducibility check)

This is the strongest form of verification. You produce the binary on your
own machine and compare its SHA-256 to the one we published.

### CLI tarball

```bash
git clone https://github.com/Camaraarthur/daemon
cd daemon
git checkout v0.1.0

SOURCE_DATE_EPOCH=$(git log -1 --pretty=%ct)
docker build \
  --file .ci/Dockerfile.cli \
  --build-arg SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} \
  --tag daemon-builder-cli:local \
  .

id=$(docker create daemon-builder-cli:local)
docker cp "${id}:/out/daemon-cli.tar.gz" ./local-daemon-cli.tar.gz
docker rm "${id}"

# Compare to the published artifact
curl -L -o published-daemon-cli.tar.gz \
  https://github.com/Camaraarthur/daemon/releases/download/v0.1.0/daemon-cli-0.1.0.tar.gz

sha256sum local-daemon-cli.tar.gz published-daemon-cli.tar.gz
# The two hashes MUST match. If they don't, file an issue immediately.
```

### Relay bundle

The relay tarball is produced by the same deterministic `tar` invocation
in `.github/workflows/release.yml` (the `build-relay` job). You can
reproduce it locally by running the same `tar` command with
`SOURCE_DATE_EPOCH` set to the tag's commit timestamp. See the workflow
file — we keep the exact command in one place, in CI, so it can't drift
from what this doc says.

### Tauri desktop AppImage

Partially reproducible as of April 2026. Rust toolchain determinism has
historically been a moving target
([rust-lang/rust#34902](https://github.com/rust-lang/rust/issues/34902)),
and while we set `SOURCE_DATE_EPOCH`, commit `Cargo.lock`, and pass
`--remap-path-prefix` to strip build paths, small differences can still
sneak in (e.g. debuginfo, linker versions). We ship the AppImage with an
attestation and a cosign signature regardless — Path A and Path B above
still prove provenance. Full bit-for-bit Tauri reproducibility is tracked
as a followup; when it lands, this doc will say so.

---

## How it works under the hood

```
┌───────────┐    git tag v*     ┌──────────────────────────┐
│  source   │ ────────────────▶ │ .github/workflows/       │
│  (commit) │                   │   release.yml (CI)       │
└───────────┘                   └────────────┬─────────────┘
                                             │
           ┌─────────────────────────────────┼─────────────────────────┐
           ▼                                 ▼                         ▼
   ┌───────────────┐               ┌──────────────────┐       ┌─────────────────┐
   │ pinned Docker │               │ actions/attest-  │       │ cosign sign-blob│
   │ image builds  │ ── digest ──▶ │  build-provenance│       │ (keyless OIDC)  │
   │ tarball       │               │ → SLSA statement │       │ → .cosign.bundle│
   └───────┬───────┘               └────────┬─────────┘       └────────┬────────┘
           │                                │                          │
           └──────────────── GitHub Release page ────────────────────── ┘
                                │
                                ▼
                       ┌────────────────┐
                       │ Sigstore       │  Rekor transparency log
                       │ (Fulcio +      │  pins every signature,
                       │  Rekor)        │  public & auditable.
                       └────────────────┘
```

- **Build environment**: a Dockerfile pinned by `@sha256:` digest (see
  `.ci/Dockerfile.cli`). Same inputs, same bytes. We chose a pinned
  Dockerfile over Nix/Guix for the CLI because the CLI is a 400-line
  Node.js script with two deps — Nix adds friction without adding
  guarantees here. See the rationale comment in `.ci/Dockerfile.cli`.
- **Deterministic tarball**: sorted entries, zeroed uid/gid, mtime fixed
  to `SOURCE_DATE_EPOCH` (the tag commit's timestamp).
- **SLSA provenance**: generated by `actions/attest-build-provenance@v2`.
  This produces a signed in-toto statement binding the artifact's SHA-256
  to the workflow file, commit SHA, runner, and invocation. Stored in
  GitHub's attestations API and on the Sigstore transparency log.
- **Cosign signature**: a second, independent signature via
  `cosign sign-blob` using GitHub Actions OIDC keyless flow. No private
  keys are held by any human — the identity is the workflow itself. The
  `.cosign.bundle` on the release includes the Rekor entry, so
  verification is offline after download.

---

## Trust anchors

When you verify, you are trusting:

| Anchor | What it is | Where it lives |
|---|---|---|
| Sigstore public-good Fulcio | Certificate authority that issues short-lived code-signing certs to GitHub Actions OIDC identities | <https://fulcio.sigstore.dev> |
| Sigstore public-good Rekor | Append-only transparency log that records every signature | <https://rekor.sigstore.dev> |
| GitHub OIDC issuer | `https://token.actions.githubusercontent.com` — identifies "this workflow ran in this repo" | GitHub |
| This repo's workflow | `Camaraarthur/daemon/.github/workflows/release.yml` — the only identity allowed to sign daemon releases | This repo |

If you trust GitHub's OIDC + Sigstore's public-good infrastructure, you
transitively trust any daemon release that verifies. That's the whole
chain — no private keys to guard, no HSM to lose.

---

## What this protects against

- A compromised daemon.page CDN serving a swapped tarball.
- A compromised npm mirror injecting a trojaned dependency between
  `git push` and a maintainer's laptop build.
- An attacker with write access to the repo pushing a release manually
  from their laptop (they don't have a valid OIDC token from
  `.github/workflows/release.yml` — only the workflow itself does).
- A supply-chain attacker replacing a release asset on GitHub
  post-publication (cosign + attestation both fail).

## What this does NOT protect against

- A backdoor introduced in the source code itself and merged to `main`.
  Reproducible builds prove the binary matches the source — if the source
  is malicious, so is the binary. Code review is a separate layer.
- A compromise of Sigstore's Fulcio/Rekor. The Sigstore public-good
  instance is run by a consortium and is as trustworthy as its operators.
- A compromise of GitHub Actions itself (i.e. the OIDC issuer lying
  about which workflow ran).
- Runtime compromise (a verified binary can still load untrusted plugins
  or be run with hostile environment variables). See `SECURITY.md`.

---

## Reporting issues

If a verification ever fails on a real release, stop what you're doing
and email `daemon@daemon.page`. See `SECURITY.md`.
