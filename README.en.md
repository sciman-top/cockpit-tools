# Cockpit Tools Local

English · [Portuguese (BR)](README.pt-br.md) · [简体中文](README.md)

[![GitHub release](https://img.shields.io/github/v/release/sciman-top/cockpit-tools-local?style=flat)](https://github.com/sciman-top/cockpit-tools-local/releases)

## Start Here

This repository is a personal self-use fork of [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools), not the official upstream release repository. The landing page, releases, version numbers, install assets, and runtime guardrails all follow the `Cockpit Tools Local` self-use semantics.

| Area | Cockpit Tools Local | Official upstream |
| --- | --- | --- |
| Repository and product identity | `sciman-top/cockpit-tools-local`, product name `Cockpit Tools Local`, Tauri identifier `com.sciman.cockpit-tools-local` | Official `jlcodes99/cockpit-tools` identity |
| Versioning and releases | Uses `official-base + -local.N`; releases publish self-use builds only and do not mirror official install assets | Uses official version numbers and official release assets |
| Upstream absorption | `main` remains the self-use source line; official source is tracked as `upstream/main` and merged only after isolated local review | Official project development line |
| Codex local enhancements | Keeps the local API Service, hardened gateway, account pool/follow-current routing, provider projection, session visibility, quota/cooldown, and continuity guards | Follows official default behavior |
| Safety and runtime boundaries | Live upstream probes, drains, dev app/server runs, and release exe replacement require explicit confirmation; current Codex/Cockpit sessions are not interrupted automatically | Host-local self-use guards are not part of upstream |

## Current Project Status

Repository status date: `2026-06-13`

- The current self-use app version is `0.24.12-local.1`, and `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` are aligned to that version.
- The current release posture is `Windows-first`: a self-use desktop control plane plus a local Hardened API Runtime that defaults to `127.0.0.1`.
- Low-risk evidence is already reusable: browser-preview UI smoke, recent-audit explainability, isolated loopback listener probes, single-account isolated upstream smoke, and `~/.codex` / `Codex App` continuity guards all have current reports.
- The hard truth boundary is still open: as of `2026-06-09`, isolated single-account upstream chat passes, but the small-pool continuity/fallback main contract is still not closed. Even with bounded drain runs, the repo still did not observe the `usage_limit_reached -> model_cooldown_applied -> fallback_blocked` chain, so same-task hard-affinity closure and new-request avoidance of exhausted/cooldown accounts remain `blocked`.
- Tray / notification / live continuity prompts are also not closed and still require explicit live acceptance rather than preview-only evidence.

Evidence entrypoints:

- [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
- [live-acceptance-blockers-20260607.md](reports/local-hardened-api-smoke/live-acceptance-blockers-20260607.md)
- [smoke-20260609-002356.json](reports/local-hardened-api-smoke/smoke-20260609-002356.json)
- [smoke-20260609-012423.json](reports/local-hardened-api-smoke/smoke-20260609-012423.json)

## Main Capabilities

Cockpit Tools Local currently supports 12 platform targets:

- Antigravity IDE
- Codex
- GitHub Copilot
- Windsurf
- Kiro
- Cursor
- Gemini Cli
- CodeBuddy
- CodeBuddy CN
- Qoder
- Trae
- Zed

Core capabilities:

- Multi-account import, switching, grouping, bulk management, and quota monitoring
- Multi-instance launch flows with isolated user data directories
- Codex Direct OAuth / API Key / Local API Service roundtrip switching
- Provider projection, session visibility repair, account-pool health state, and cooldown registry
- Hardened local API mode, redacted stream/audit evidence, and low-risk defaults
- Windows-first local entrypoints, self-use release flow, and compatible absorption of the official CLIProxyAPI sidecar model

Notes:

- Gemini Cli does not support multi-instance management yet.
- OpenCode is currently a companion integration, not one of the 12 platform targets above.
- The UI currently ships 18 languages, including English, Simplified Chinese, Traditional Chinese, Japanese, German, Spanish, French, Italian, Korean, Portuguese, Russian, Turkish, Polish, Czech, Arabic, Vietnamese, Indonesian, and the `en-US` compatibility locale.

## Documentation Map

Recommended reading order:

1. [README.md](README.md)
2. [SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md)
3. [UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)
4. [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
5. [LOCAL_HARDENED_API.md](docs/LOCAL_HARDENED_API.md)
6. [COCKPIT_LOCAL_TARGET_ARCHITECTURE.md](docs/COCKPIT_LOCAL_TARGET_ARCHITECTURE.md)
7. [CHANGELOG.md](CHANGELOG.md)

Use these entrypoints by topic:

- Codex local API / Hardened API: [LOCAL_HARDENED_API.md](docs/LOCAL_HARDENED_API.md)
- Current release acceptance truth: [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
- Remaining blockers / truth boundary: [LOCAL_HARDENED_API_NEXT_PHASE_BACKLOG.md](docs/LOCAL_HARDENED_API_NEXT_PHASE_BACKLOG.md)
- Upstream absorption and local delta: [SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md), [UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)
- Local reference shelf and source snapshots: [reference-sources.md](docs/reference-sources.md)
- Ubuntu / WSL2 local builds: [build-wsl2-ubuntu24.md](docs/build-wsl2-ubuntu24.md)

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+
- Rust stable

### Install dependencies

```bash
npm install
```

### Start the development profile

```bash
npm run typecheck
npm run tauri:dev
```

`npm run tauri:dev` launches the isolated `Cockpit Tools Dev` profile instead of overwriting the default self-use data directory.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Fast TypeScript feedback |
| `npm run build` | Frontend build with version sync and typecheck |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust lib tests |
| `npm run release:preflight` | Full release preflight |
| `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test` | Contract/invariant checks only |
| `npm run tauri:dev` | Start the desktop dev profile |
| `npm run tauri -- build` | Run the Tauri packaging wrapper |
| `npm run preview -- --host 127.0.0.1 --port 4173` | Frontend-only preview for browser-preview smoke |

Default gate order in this repo:

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
3. `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`
4. Hotspot review for `SECURITY.md`, `src-tauri/capabilities/`, release scripts, quota/cooldown/pool routing, i18n, and live continuity risk boundaries

## Installation

### Manual download

Download self-use builds from this repository's [Cockpit Tools Local Releases](https://github.com/sciman-top/cockpit-tools-local/releases). Releases here represent `Cockpit Tools Local` only. If the current version does not yet have install assets, build locally with the development flow above instead of treating official upstream releases as this local edition.

- macOS: `.dmg`
- Windows: `.msi` or `.exe`
- Linux: official Linux assets are not treated as Local release assets by default; build locally when needed

### Homebrew (macOS)

```bash
brew tap sciman-top/cockpit-tools-local https://github.com/sciman-top/cockpit-tools-local
brew install --cask cockpit-tools
```

If the self-use cask has not been updated yet, prefer manual download or local build instead of the official upstream tap.

## Security & Privacy

- This is a local desktop tool; account data is primarily stored on your own machine.
- WebSocket binds to `127.0.0.1` by default on port `19528`.
- The hardened Codex default covers loopback only; LAN listening is advanced opt-in, not the default recommendation.
- OAuth login, token refresh, quota fetching, and update checks call official upstream services.
- Do not share a full user directory directly; redact token / auth files first.

Common local data roots:

- `~/.antigravity_cockpit`
- `~/.codex`
- `~/.gemini`
- local app-data folders under `com.antigravity.cockpit-tools*`

## Development Notes

- Low-risk checks such as `npm run typecheck`, `npm run build`, Cargo tests, and focused checks are expected to run normally.
- Commands that start or restart live app/server flows, such as `npm run dev`, `npm run tauri:dev`, `npm run tauri -- build`, or smoke/drain commands that consume real upstream quota, should be treated as higher-risk actions and explained before running.
- Do not automatically stop, restart, kill, or relaunch `Codex App`, `codex`, Cockpit release binaries, or the current live dev app/server without explicit confirmation.
- Before changing Codex API service, routing, quota continuity, pool scheduling, or failover behavior, check [reference-sources.md](docs/reference-sources.md) and the local reference shelf first.

## Community

- Telegram: [Join the group](https://t.me/+Y8gMv4SlZUU2MWY1)

## Support

If this project helps you, you can support it here: [☕ Donate](docs/DONATE.en.md)

## Acknowledgments

- Antigravity IDE switching logic reference: [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager)
- Codex API service sidecar reference: [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## License

This project uses [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

- Allowed: personal learning, research, and non-commercial use/modification
- Not allowed: unauthorized commercial use
- Commercial license: contact the author for separate written authorization

## Disclaimer

This project is for personal learning and research only. By using it, you agree to:

- avoid commercial use without prior written authorization
- accept the risks and responsibilities of using it
- comply with applicable terms, laws, and regulations
