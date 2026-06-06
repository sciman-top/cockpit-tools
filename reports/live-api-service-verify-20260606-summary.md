# Cockpit API Service Live Verification Summary - 2026-06-06

This report is a sanitized summary of local live probes. Raw runtime snapshots are intentionally not committed because they contain local `auth.json`, Codex config, SQLite state, and bearer/API/OAuth tokens.

## Scope

- Repository: `D:\CODE\external\Cockpit-Tools-Local`
- Built binary: `target\release\cockpit-tools.exe`
- Main fix commit under test: `30cf35b0 fix: 修复 Codex API 服务启动与 OAuth 状态漂移`
- Risk note: live probes touched local Codex runtime projection and Cockpit API service state.

## Verified Outcomes

1. API-key-only API service startup no longer fails with the old OAuth-only binding error.
   - Probe: `codex exec --ephemeral --json --skip-git-repo-check`
   - Result: exit status `0`
   - Observed response: `API Key Cockpit API Service OK`

2. OAuth API service runtime projection can switch Codex into Cockpit API service mode.
   - Probe: `codex exec --ephemeral --json --skip-git-repo-check`
   - Result: exit status `0`
   - Observed response: `OAuth Cockpit API Service OK。`

3. Runtime mode files were projected as Cockpit API service.
   - Observed mode: `cockpit_api_service`
   - Observed provider name: `Cockpit API Service`
   - Observed local base URL shape: `http://localhost:<port>/v1`

4. Sidecar OAuth projection now includes non-sensitive restart markers.
   - Observed marker fields: `authTokenGeneration`, `authTokenUpdatedAt`, `authAccessTokenExpiresAt`
   - Purpose: sidecar process fingerprint changes when OAuth token material changes, so stale auth can no longer remain silently attached.

## Raw Evidence Handling

The following local report directories were scanned and found to contain secrets or local runtime state, so they remain untracked and are ignored:

- `reports/live-api-service-verify-20260606-*`
- `reports/live-verify-20260605-231830/`

Examples of excluded sensitive material:

- `OPENAI_API_KEY`
- OAuth `access_token` / `refresh_token`
- `experimental_bearer_token`
- Codex session SQLite databases
- copied Codex home directories

## Remaining Follow-Up

The live state later showed a stale health-registry entry for the OAuth account `agi.phys@gmail.com` marked as prior account-level `401/manual_required` while the account card still showed quota health. The next root-cause slice is to make health recovery distinguish true reauth-required failures from stale pre-refresh 401 state, then verify the UI no longer shows the red service warning for a healthy refreshed account.
