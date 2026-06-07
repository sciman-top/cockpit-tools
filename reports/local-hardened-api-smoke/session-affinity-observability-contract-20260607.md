# Session Affinity Observability Contract - 2026-06-07

状态：pass
时间：2026-06-07 Asia/Shanghai
目标：收口 `HLA-07` 中 `Session_id / X-Client-Request-Id` 的真实边界，避免把 thread-scoped request id 误解为 hard turn affinity。

## 1. 结论

- `Session_id` / `session_id` / `x-session-id` / `x-amp-thread-id`
  - 已进入 soft `session_affinity` 选择链路。
  - 当 `collection.session_affinity = true` 时，会参与 `session_affinity_key` 计算，并可把已成功账号继续置前。
  - 当前作用是低频、自用场景下的软会话连续性，不是 `x-codex-turn-state` 那种官方 hard turn affinity。

- `X-Client-Request-Id`
  - 会进入 `request_id_source` / failure log / audit observability。
  - 会被 `extract_session_affinity_key()` 视为可选 soft session 来源之一，仅在显式开启 `session_affinity` 时参与 soft key。
  - 不会成为 `request_affinity_key()`，也不会单独把新 turn 钉死在旧账号。
  - 对 Codex `/v1/responses` 来说，它是 thread-scoped observability，不是 hard continuation token。

## 2. 代码锚点

- hard request affinity 仍只认官方 turn-state：
  - `request_affinity_key(request)` -> `official_codex_turn_state_affinity_key(request)`
- soft session affinity 来源：
  - `extract_session_affinity_key(request)`
  - `extract_session_affinity_source(request)`
- selector / recent audit explainability：
  - `selector_audit_detail(..., session_affinity_source)`
  - `parse_recent_health_audit_event_from_audit_event(...)`

## 3. focused 证据

- `cargo test --manifest-path src-tauri/Cargo.toml selector_audit_detail_keeps_session_affinity_source_without_raw_value --quiet`
  - 证明 selector audit 只保留 `session_affinity_source` 标签，不泄露原始值。
- `cargo test --manifest-path src-tauri/Cargo.toml parse_recent_health_audit_event_extracts_redacted_chain_fields --quiet`
  - 证明 recent audit UI 摘要可读取 `request_id_source` / `session_affinity_source`，仍保持脱敏。
- 仓内既有 focused tests：
  - `same_client_request_id_does_not_block_independent_fallback_after_usage_limit`
  - `active_stream_lease_uses_turn_state_affinity_even_with_client_request_id`
  - metadata / lineage 相关 tests
  - 共同证明 `X-Client-Request-Id` 不升级为 hard turn affinity。

## 4. 用户可见口径

- UI 可以显示：
  - `请求来源: X-Client-Request-Id`
  - `亲和来源: Session_id`
- UI 不显示：
  - 原始 session 值
  - 原始 client request id 全值之外的额外敏感上下文
  - 任何会让用户误以为 `X-Client-Request-Id` 等同 `x-codex-turn-state` 的口径

## 5. 不做事项

- 不把 `X-Client-Request-Id` 当作 hard continuation key。
- 不把 metadata-only lineage 升级成 sticky routing boundary。
- 不为这条 explainability 扩展引入新的 live probe 或额外上游请求。
