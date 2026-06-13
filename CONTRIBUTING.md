# Contributing to Cockpit Tools Local

Thank you for helping with `sciman-top/cockpit-tools-local`.

This repository is a self-use fork of `jlcodes99/cockpit-tools`. Contributions must preserve the local fork semantics instead of assuming the official upstream release posture.

## Before You Change Anything

Read these files first:

1. [README.md](README.md)
2. [docs/SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md)
3. [docs/UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)
4. [docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)

Keep these repo truths intact:

- `main` is the self-use source line for this fork.
- Releases publish self-use assets only.
- Windows-first runtime assumptions are intentional.
- Codex local API / hardened runtime / continuity guard behavior is part of the local delta and must not be overwritten casually by upstream code.

## Local Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Rust stable

### Install

```bash
npm install
```

### Development profile

```bash
npm run typecheck
npm run tauri:dev
```

`npm run tauri:dev` launches the isolated `Cockpit Tools Dev` profile rather than overwriting the default self-use data directory.

## Project Structure

- `src/`: React UI, hooks, utilities, styles, assets, i18n
- `src-tauri/`: Tauri shell, commands, capabilities, platform integration
- `crates/cockpit-core/`: shared Rust logic for accounts, providers, OAuth, quotas, config, persistence
- `crates/cockpit-cli/`: CLI entrypoint
- `scripts/`: version sync, locale checks, release preflight, smoke/acceptance helpers
- `docs/`, `reports/`, `public/`, `Casks/`: documentation, evidence, static assets, release metadata

Do not edit generated output directories such as `dist/`, `target/`, `target-test/`, `target-codex-verify/`, `target-codex-tauri-*`, or `node_modules/`.

## Verification Order

Default gate order for code changes:

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
3. `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`
4. Hotspot review for:
   - `SECURITY.md`
   - `src-tauri/capabilities/`
   - updater / signing / release scripts
   - quota / cooldown / pool routing / continuity
   - i18n text
   - live continuity risk boundaries

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Fast TypeScript feedback |
| `npm run build` | Frontend build with version sync |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust lib tests |
| `npm run release:preflight` | Full release preflight |
| `npm run tauri:dev` | Desktop development profile |
| `npm run tauri -- build` | Tauri packaging wrapper |

For documentation-only changes, full code gates may be `gate_na`, but you should still run at least lightweight verification such as `git diff --check` and any doc-adjacent checks that the touched files depend on.

## Documentation Expectations

When behavior, commands, release posture, or user-visible flows change, update the relevant docs in the same change:

- `README*.md`
- `CHANGELOG*.md`
- `docs/LOCAL_HARDENED_API*.md`
- `docs/SELF_USE_DELTA.md`
- `docs/UPSTREAM_SYNC_POLICY.md`
- `docs/reference-sources.md`

Do not leave docs implying that blocked live acceptance is already complete. Keep repo-side truth boundaries explicit.

## High-Impact Areas

Treat these areas as high impact and document rollback/evidence clearly:

- auth / provider projection
- Codex API service and routing
- quota continuity and cooldown behavior
- updater / signing / release assets
- Tauri capabilities
- live runtime continuity

Do not automatically stop, restart, kill, relaunch, or replace the live `Codex App`, `codex`, Cockpit release exe, or current live dev app/server without explicit confirmation.

## Pull Requests

When opening a PR or change summary:

- explain whether the change is self-use specific, upstream-compatible, or a local adaptation of upstream code
- list the commands you used for verification
- call out any remaining blockers or `platform_na` / `gate_na` items
- mention doc updates whenever user-visible behavior or repo workflow changed

## Release Notes and Versioning

- Keep the self-use version scheme as `official-base + -local.N`.
- Do not publish bare upstream version numbers from this repo.
- Keep `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` aligned.

## Questions

If you are unsure whether a change should preserve local behavior or absorb upstream behavior, compare it against:

- [docs/SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md)
- [docs/UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)

Default bias: preserve the local self-use behavior unless there is clear evidence that the upstream behavior is better and safe for this fork.
