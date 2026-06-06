# Cockpit API Service Live Verification - 2026-06-06 13:08 +08

## Scope
- Repo: `D:\CODE\external\Cockpit-Tools-Local`
- Branch: `main`
- Fix commit under verification: `1e9b5a53 fix: 放宽 API 服务启用连续性保护`
- Target: verify Cockpit API service mode can be enabled from Direct projection, works with a single upstream API Key account, and does not mark `agi.phys@gmail.com` as 401/manual-required when used as an OAuth pool member.

## Root Cause Fixed
- `DirectProjection -> CockpitApiService` was blocked when only a Codex App process existed, even when there were no active local-access streams. The guard now blocks this direction only for active local-access risk (`active_stream_count > 0` or recent audit activity).
- App exit no longer restores `cockpit_api_service` back to `direct_projection`, preserving the user-selected runtime mode.

## Gates
- `git diff --check`: exit 0.
- `npm run build`: exit 0.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib`: exit 0, `459 passed; 0 failed; 2 ignored`.
- `node scripts\release\preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`: exit 0.
- `npm run tauri build`:
  - First attempt failed because `target\release\cockpit-tools.exe` was locked by the running release app process (`os error 5`).
  - After stopping only that Cockpit Tools release process, the second run exited 0 and built `D:\CODE\external\Cockpit-Tools-Local\target\release\cockpit-tools.exe`.

## Live Runtime Evidence
- Started release app from: `D:\CODE\external\Cockpit-Tools-Local\target\release\cockpit-tools.exe`.
- WebSocket control port: `19528`.
- After `request.codex_runtime_mode_set` with `mode="cockpit_api_service"`:
  - WS response: `response.codex_runtime_mode`, `mode="cockpit_api_service"`, `accountKind="api"`, `currentAccountId="codex_local_access_runtime"`.
  - `C:\Users\sciman\.antigravity_cockpit\codex_runtime_mode.json`: `mode="cockpit_api_service"`.
  - `C:\Users\sciman\.codex\codex_runtime_mode.json`: `mode="cockpit_api_service"`.
- Codex projection check:
  - `C:\Users\sciman\.codex\config.toml` contains current `model_provider = "codex_local_access"` and `[model_providers.codex_local_access] base_url = "http://localhost:45335/v1"`.
  - `C:\Users\sciman\.codex\auth.json` uses a local `agt_codex_...` service key shape; raw key not recorded.

## Single Upstream API Key Pool
- Live config set to one upstream API Key account in `accountIds`:
  - `codex_apikey_463c5a855ae8aa2b36112aae81d1ecf1`
  - `boundOauthAccountId`: absent
  - `routingStrategy`: `custom`
- API service state after activation:
  - `enabled=true`
  - `port=45335`
  - `gatewayMode=sidecar`
  - `accountCount=1`
- HTTP probe:
  - `GET http://127.0.0.1:45335/v1/models`
  - Auth: local service key, redacted
  - Result: HTTP 200, 13 models.
- Codex CLI live request:
  - Command: `codex exec --ephemeral --json --skip-git-repo-check "请只回复：你好，你是谁？"`
  - Exit: 0
  - Agent message: `你好，你是谁？`
  - Usage was reported by Codex CLI.

## `agi.phys@gmail.com` OAuth Pool
- Account id: `codex_f9c21376dc05ab18f5d70f4e61b66a34`
- Account snapshot before OAuth pool run:
  - `authMode=oauth`
  - `planType=go`
  - `hasRefresh=true`
  - `hasAccess=true`
  - `tokenGeneration=2`
- Live config set to one OAuth account in `accountIds`:
  - `codex_f9c21376dc05ab18f5d70f4e61b66a34`
  - `boundOauthAccountId`: absent
  - `routingStrategy`: `custom`
- Service probe:
  - `GET http://127.0.0.1:45335/v1/models`
  - Result: HTTP 200, 14 models.
- Codex CLI live request:
  - Command: `codex exec --ephemeral --json --skip-git-repo-check "请只回复：你好，你是谁？"`
  - Exit: 1
  - Error: `exceeded retry limit, last status: 429 Too Many Requests`
  - Interpretation: live failure was quota/rate-limit related, not a 401 auth failure.
- Health after OAuth pool run:
  - `status=estimated_available`
  - `lastStatus=null`
  - `lastErrorType=null`
  - `manualRequired=false`
  - Recent audit scan for `status=401` or `errorType=auth_error`: `0`.

## Reference Sync Evidence
- Upstream mirror branch `mirror/upstream-main` was pushed to `0f8d9e0c`.
- Local official `openai-codex` source at `D:\CODE\external\Cockpit-Tools-Local-references\openai-codex` was refreshed to `3ea9e9833`.
- Local upstream Cockpit source was cloned at `D:\CODE\external\Cockpit-Tools-Local-references\cockpit-tools-upstream`.

## Backups And Rollback
- Runtime projection backup before API service live switch:
  - `C:\Users\sciman\.antigravity_cockpit\backups\codex-runtime-projection-before-api-service-20260606-125913`
- Single API Key pool config backup:
  - `C:\Users\sciman\.antigravity_cockpit\backups\codex-local-access-live-api-key-pool-20260606-125757`
- `agi.phys@gmail.com` OAuth pool config backup:
  - `C:\Users\sciman\.antigravity_cockpit\backups\codex-local-access-live-agi-oauth-pool-20260606-130257`
- Git rollback for code:
  - `git revert 1e9b5a53`

## Current Live State At Report Time
- Cockpit Tools release app is running from `target\release\cockpit-tools.exe`.
- Cockpit API service is enabled on port `45335`.
- Codex runtime mode mirrors are `cockpit_api_service`.
- Current live API service pool contains `agi.phys@gmail.com` (`codex_f9c21376dc05ab18f5d70f4e61b66a34`).
