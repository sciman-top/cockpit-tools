# Local Hardened API Codex Responses Protocol

状态：active
更新时间：2026-06-06

## 1. 目的

本文件定义 Cockpit Tools Local 在 Codex-facing `/v1/responses` 路径上的协议级合同，重点回答三件事：

1. 什么情况下必须保持官方 Responses/turn 语义。
2. 什么情况下允许返回本地 `completed Responses` 闭合。
3. 什么输出会被视为连续性回归。

产品级合同见 `docs/HARDENED_API_PRODUCT_REQUIREMENTS.md`，总控语义见 `docs/HARDENED_API_MASTER_PLAN.md`，sticky/quota 连续性边界补充见 `docs/local-hardened-api-quota-continuity-guardrails.md`。

## 2. 官方语义锚点

以下锚点用于约束本地兼容实现，优先级高于社区网关习惯：

- OpenAI Responses Overview 说明 Responses API 支持使用前一轮 response 输出继续构建 stateful interaction。
- OpenAI error codes 文档说明：`previous_response_not_found` 应以完整上下文重试，并把 `previous_response_id` 置为 `null`；这说明 `previous_response_id` 不是可跨账号伪造的“任意续接令牌”。
- OpenAI rate limits 文档说明：429/503 需要 pacing、backoff，并应尊重响应头中的速率限制元数据；失败重试本身也会消耗 per-minute limit。
- 本地官方源码镜像 `D:\CODE\external\Cockpit-Tools-Local-references\openai-codex` 是 turn state、terminal 事件、continuation 与 stream 断开语义的最高实现锚点。

## 3. 术语

### 3.1 Hard Affinity

以下任一信号出现，即进入 hard-affinity：

- `previous_response_id`
- `x-codex-turn-state`

Hard-affinity 请求不得静默跨账号续接。

### 3.2 Metadata-only Lineage

以下信号只用于 lineage / observability，不构成 hard-affinity：

- `x-codex-turn-metadata`
- `x-codex-turn-metadata.turn_id`
- `x-client-request-id`

### 3.3 Independent Admission

不带 hard-affinity 信号的新请求，或基于完整上下文重放的新 admission，属于 independent admission。它可以重新选择健康账号，但必须遵守 `maxRetryAccounts`、本地 backpressure 和请求预算。

### 3.4 Local Completed Responses

本地 `completed Responses` 是一种客户端终态合同，用于显式表达“本地已决定本轮不能继续等待上游”。它不是 upstream success，也不能被当作“旧任务在上游完成”的证据。

## 4. 合同矩阵

| 场景 | 允许行为 | 禁止行为 | 结果归类 |
| --- | --- | --- | --- |
| 普通 HTTP 客户端，全池不可调度 | 返回本地 `503/pool_unavailable` JSON + `Retry-After` | 伪装成 upstream 429 | 正常本地拒绝 |
| Codex-facing 新 independent admission，全池不可调度但短等待内恢复 | 在本次请求预算内短等待并继续转发真实上游 | 无限等待、heartbeat-only open wait | 正常恢复 |
| Codex-facing 新 independent admission，短等待后仍不可恢复 | 返回本地 `200 completed Responses` SSE/JSON 闭合 | transport `503`、`response.failed`、静默断线 | 正常本地闭合 |
| Hard-affinity continuation 在 admission 前遇到 quota/cooldown | 只允许原账号短等待或显式 terminal error | 跨账号复用旧 `previous_response_id`、静默换号 | continuation 风险受控 |
| Hard-affinity continuation 进入 `in_band_local_completion` | 记录为提前结束风险/监测失败 | 标记为成功 continuity | 连续性失败证据 |
| 已 admitted 的 active stream | 继续在原账号跑到 terminal 或真实 transport fatal error | mid-stream 切号、retroactive cancel | 正常 active lease |

## 5. Codex-facing `pool_unavailable` 协议

### 5.1 允许触发本地 completed 的前提

只有在以下条件同时满足时，Codex-facing `/v1/responses` 才允许本地闭合：

- 当前请求属于 independent admission，而不是 hard-affinity continuation。
- 当前请求尚未获得可判定的 upstream admitted 信号。
- 当前请求在本次 timeout / queue / backoff 预算内完成了短等待尝试。
- 当前号池仍无可调度账号，或最近恢复窗口超出本次请求预算。

### 5.2 Streaming 最小终态合同

Streaming 闭合必须满足：

- 事件序列以 `response.created` 开始。
- 包含可见 assistant text，明确说明 `Cockpit API Service pool_unavailable`。
- 终态必须显式到 `response.completed`。
- 以 `[DONE]` 收束。

禁止以下退化输出：

- transport `503/pool_unavailable`
- `response.failed`
- heartbeat-only open wait
- parked SSE idle
- 空白 `completed` assistant message
- 静默断线

### 5.3 Non-stream 最小终态合同

Non-stream JSON 必须满足：

- `status = completed`
- 输出中包含可见 assistant text，说明本地 `pool_unavailable`
- metadata 至少能表达：
  - `outcome = in_band_local_completion`
  - `errorType = pool_unavailable`
  - `recover_action`

### 5.4 绝不能被误判为上游成功

本地 `completed Responses` 只能表示“客户端拿到了显式终态”，不能表示：

- upstream 已真正完成
- old turn 在原账号上已跑到 terminal
- hard-affinity continuity 已通过

## 6. Hard-affinity 特殊规则

对 hard-affinity continuation：

- 原账号 admission 前返回 429/quota exhausted 时，只允许在原账号短等待恢复，或返回显式 terminal error。
- 若要切到新账号，必须把它视为 full context replay / compacted replay 的新 admission，且不再直接复用旧 `previous_response_id`。
- 任何 `fallback_blocked + outcome=hard_affinity + in_band_local_completion` 都应进入 acceptance/monitor fail，而不是 pass。

## 7. Audit 与验收字段

以下字段必须能在 audit、report 或 summary 中看到：

- `request_id`
- `hard_affinity`
- `pool_wait`
- `fallback_blocked_reason`
- `blocking_status_counts`
- `nearest_retry_after_ms`
- `streamState`
- `outcome`
- `errorType`
- `recover_action`

推荐将结果分为以下几类：

- `upstream_completed`
- `local_completion_pool_unavailable`
- `transport_pool_unavailable`
- `failed_pool_unavailable`
- `heartbeat_pool_wait`
- `parked_pool_wait_timeout`

## 8. 统一验收入口

低风险协议回归：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib pool_unavailable_sticky_responses_keeps_http_error_contract
cargo test --manifest-path src-tauri/Cargo.toml --lib previous_response_id_hard_affinity_blocks_fallback_after_usage_limit
cargo test --manifest-path src-tauri/Cargo.toml --lib codex_turn_metadata_is_lineage_only_not_hard_affinity
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test-local-hardened-api-live-monitor.ps1
```

产品级 acceptance 入口：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/accept-local-hardened-api-continuity.ps1 -Model gpt-5.5 -AcknowledgeLiveUpstreamRisk -SkipEphemeralGatewayBuild
```

## 9. 当前仍待决策

1. 本地 `completed Responses` 是否长期作为正式对外合同保留。
2. assistant text 与 metadata 字段是否需要再细分为稳定 schema。
3. 是否把 hard-affinity terminal error 与 independent local completion 的 UI 文案彻底拆开。
