# Local Hardened API Quota Continuity Guardrails

Last reviewed: 2026-05-30
Mirror refreshed: 2026-06-06

## Verdict

The current implementation is considered broadly successful for ordinary admitted-stream continuity and new independent request failover after OAuth account exhaustion.

It is not acceptable to treat a hard-affinity continuation as locally successful when the original account is exhausted. A request carrying official sticky state must either complete upstream on the bound account, retry the same account only inside the short reset window, or return an explicit quota terminal error.

Protocol-level interpretation of local completed Responses now lives in `docs/LOCAL_HARDENED_API_CODEX_RESPONSES_PROTOCOL.md`; this memo remains the sticky-boundary and quota-continuity guardrail addendum.

## Official Codex Compatibility Anchors

Reviewed against local official source mirror:

- `D:\CODE\external\Cockpit-Tools-Local-references\openai-codex`
- commit `8a827d6` (`Expose MCP server info as part of server status (#24698)`)
- current local mirror HEAD `87b808bb5` (`Support custom shell environment for local shell tool (#27023)`)

说明：本备忘录的结论最初锚定到 2026-05-30 审查时使用的 `8a827d6`。当前本地镜像已经刷新到 `87b808bb5`，后续如继续扩展 continuity / sticky-boundary 结论，应优先对照新镜像和 `docs/reference-sources.md`。

Relevant official source facts:

- `codex-rs/core/src/client.rs`: `ModelClientSession` is turn-scoped; `x-codex-turn-state` is captured and replayed only within the same turn.
- `codex-rs/core/src/client.rs`: `previous_response_id` is produced only from a completed upstream response and binds Responses continuation.
- `codex-rs/core/src/client.rs`: `x-codex-turn-metadata` is optional observability metadata, not a hard-affinity routing token.
- `codex-rs/core/src/session/turn.rs`: `ResponseEvent::Completed` records `completed_response_id`; only after this completion does Codex send `response_processed`.

## Non-Negotiable Behavior

- `x-codex-turn-state` and `previous_response_id` are official sticky boundaries.
- `x-codex-turn-metadata` and `x-codex-turn-metadata.turn_id` are lineage/observability only.
- A sticky boundary must not fall through to another account.
- A sticky boundary must not be closed with local `response.completed` / `in_band_local_completion` for `pool_unavailable`.
- An already admitted stream must keep its active lease and finish on the original account even if that account is marked exhausted while the stream is running.
- A new independent request may avoid exhausted/cooldown accounts and use a healthy replacement account.
- Independent `/v1/responses` requests may receive a local completed Responses payload for explicit `pool_unavailable`; this is a client-facing terminal contract, not proof of upstream completion.

## Historical Issues Now Guarded

- Retry-limit 429 surfaced as `exceeded retry limit, last status: 429 Too Many Requests` instead of structured quota/failover handling.
- Local backpressure queue wait did not always cover the request-start interval.
- `pool_unavailable` previously risked leaking as transport 503, `response.failed`, or SSE idle instead of an explicit terminal contract.
- Sticky turn/request affinity could be confused with metadata-only lineage.
- `previous_response_id` continuation risked cross-account reuse without a hard original-account boundary.
- Hard-affinity reset waits could be oversized or killed by the local request timeout.
- Live monitor evidence previously required manual JSON inspection to decide whether in-flight streams survived account exhaustion.

## Regression Gates

Use these focused checks before changing quota continuity, account-pool routing, or local monitor semantics:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test-local-hardened-api-live-monitor.ps1
cargo test --manifest-path src-tauri/Cargo.toml --lib pool_unavailable_sticky_responses_keeps_http_error_contract
cargo test --manifest-path src-tauri/Cargo.toml --lib previous_response_id_hard_affinity_blocks_fallback_after_usage_limit
cargo test --manifest-path src-tauri/Cargo.toml --lib codex_turn_metadata_is_lineage_only_not_hard_affinity
node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test
```

For release-quality closure, keep the repository gate order:

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test
```

## Evidence From 2026-05-29 Runs

Earlier raw `reports/local-hardened-api-realrun/...` artifacts were intentionally removed from the repository during size cleanup because they were bulky runtime captures, not source-of-truth code.

The durable conclusion to retain is:

- first account exhaustion: new independent requests avoided the exhausted account
- second account exhaustion: most admitted streams completed, but one hard-affinity request was locally completed and must remain a fail signal
- one in-flight stream completed after the second account's first `429`, while one older gateway remained unresolved in the primary window

For current verification, prefer the focused tests and lighter-weight acceptance/doc entrypoints above instead of depending on archived raw monitor dumps.

