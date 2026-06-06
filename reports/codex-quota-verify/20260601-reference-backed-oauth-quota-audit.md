# Codex OAuth quota/account reference-backed audit

Date: 2026-06-01
Branch: codex/upstream-sync-v0.24.11-20260601

## Evidence sources

- Local official source: `D:\CODE\external\Cockpit-Tools-Local-references\openai-codex`, commit `f27bbbd49 Add goal extension GoalApi (#25096)`.
- Official source anchors:
  - `codex-rs/protocol/src/auth.rs`: known raw plan values are `free`, `go`, `plus`, `pro`, `prolite`, `team`, `self_serve_business_usage_based`, `business`, `enterprise_cbp_usage_based`, `enterprise`/`hc`, `education`/`edu`.
  - `codex-rs/protocol/src/account.rs`: app-facing plan type keeps `ProLite`, usage-based business variants, workspace helper groups.
  - `codex-rs/protocol/src/error.rs`: usage-limit copy treats `free` and `go` as upgrade-to-Plus, `plus` as upgrade-to-Pro, `pro`/`prolite` as purchase-more-credits, and workspace/business plans separately.
  - `codex-rs/tui/src/chatwidget/rate_limits.rs`: rate-limit snapshots preserve prior `plan_type` when a new snapshot has none.
  - `codex-rs/core/src/state/session.rs`: rate-limit snapshots are merged rather than blindly replacing missing fields.
- Public OpenAI documentation anchors:
  - Rate limits guide: rate limits/reset metadata may appear in response headers and unsuccessful requests still count toward per-minute limits.
  - Error codes guide: 429 distinguishes rate limits from exhausted quota / maximum spend.

## Matrix

| Field / behavior | Official/reference semantics | Cockpit owner | Fix / invariant |
| --- | --- | --- | --- |
| `plan_type` known values | Official known set includes `go`, `prolite`, workspace and usage-based business aliases. | Backend `src-tauri/src/modules/codex_account.rs`; frontend `src/types/codex.ts`; pool summary `src/utils/codexQuotaPool.ts`. | Backend paid evidence is explicit and no longer treats every non-free string as paid. Frontend display/filter/pool keys include `go`, `prolite`, `business`, `edu`. |
| `go` plan | Official usage-limit copy groups `go` with `free`, not paid. | `is_paid_codex_plan_type`, `resolve_observed_plan_type`. | `go` is not paid evidence and cannot downgrade an existing `plus`/paid account during transient observation. |
| `subscription_active_until` | Token/snapshot absence is missing observation, not deletion evidence. | `sync_identity_from_tokens`, `upsert_account_with_hints`, `apply_local_oauth_snapshot`, `upsert_account_from_access_token`. | New `merge_subscription_active_until` only writes normalized non-empty observed values. Missing claims preserve stored/indexed expiry. |
| OAuth identity IDs | Official tests use both nested `chatgpt_account_id` and top-level `account_id`; Cockpit already reads id token and access token variants. | `extract_user_info`, `extract_access_token_identity`, `build_account_storage_id`. | No new change; existing strict `email + account_id + organization_id` matching remains the storage identity boundary. |
| Quota/reset windows | Official source models primary/secondary windows, reset times, and merges partial snapshots. Public docs also expose rate-limit reset headers. | `src-tauri/src/models/codex.rs`, `src-tauri/src/modules/codex_quota.rs`, local access health registry. | No high-confidence code change in this slice; existing `normalize_window_slots` and reset recovery align with merge-not-replace semantics. |
| 429 classification | Official source separates `QuotaExceeded`, `UsageNotIncluded`, `UsageLimitReached`, generic 429/rate limit, and server overload. | `codex_quota.rs`, `codex_local_access.rs`, `quota_error` UI. | No live upstream probing was run; this slice only used official source and local tests. |

## Regression tests added/updated

- `paid_plan_detection_matches_official_known_plan_families`
- `go_plan_observation_does_not_override_existing_plus_plan`
- `sync_identity_from_tokens_preserves_existing_subscription_when_claim_is_missing`
- `local_oauth_snapshot_preserves_existing_subscription_when_claim_is_missing`
- `upsert_account_with_hints_preserves_paid_plan_when_token_claims_are_free` now also asserts subscription expiry preservation in account detail and index summary.

## Residual follow-up candidates

- Extract shared plan normalization into one Rust/TypeScript-generated contract to remove dual maintenance.
- Add frontend unit tests if the project later enables a TS test runner; currently this repo has no dedicated Vitest/Jest config.
- Continue a second audit slice on `codex_quota.rs` and `codex_local_access.rs` 429 reset inference against `codex-rs/codex-api/src/rate_limits.rs`.
