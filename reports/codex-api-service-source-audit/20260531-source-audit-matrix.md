# Codex API Service Source Audit Matrix

审查日期：2026-05-31
目标归宿：Cockpit API service 的 stream/quota continuity 证据闭环
当前落点：本报告只记录审计证据和本仓对齐判断，不改变 live runtime state，不触发真实上游 quota drain。

## Scope

本轮聚焦用户提出的问题：在 ChatGPT Free/Plus 类账号出现 `usage_limit_reached` 信号前，如果某个 stream 已经进入“上游已接受并开始下游写出（headers/first chunk）”状态，Cockpit API service 是否会保持该 stream 在原上游自然跑到 terminal，而不是被本地 cooldown、fallback、切号或 monitor 误判打断。

本报告区分三类事实：

- 本仓能保证：本地服务在 `upstream_admitted` 后记录 stream 边界；headers 或 first chunk 写出后禁止本地 fallback/切号改写响应身份；monitor 能把账号耗尽时的 in-flight stream 分为 pass/fail/blocked/skipped。
- 本仓不能伪造：若上游在接受前直接返回 `429 usage_limit_reached`，本地不能把它变成继续生成，只能结构化记录、冷却并对新请求择路。
- 本轮未执行：真实上游 quota drain、live Cockpit/Codex 重启、release exe 替换或 active provider 切换。

## Source Refresh

刷新命令均为非破坏性 `git pull --ff-only`。五个参考源均已刷新到远端当前快进状态，且工作树 clean。

| Source | Local path | Branch | HEAD | Role |
| --- | --- | --- | --- | --- |
| OpenAI Codex | `D:\CODE\external\_reference_gateway_sources\openai-codex` | `main` | `966932124` | 官方最高优先级：Codex Responses/SSE/turn state/`previous_response_id` 语义 |
| LiteLLM | `D:\CODE\external\_reference_gateway_sources\litellm` | `litellm_internal_staging` | `a9cc6ed` | cooldown、pre-call rate checks、proxy 429/`retry-after` 参考 |
| New API | `D:\CODE\external\_reference_gateway_sources\new-api` | `main` | `230a359` | 渠道重试、自动禁用、全局/模型限流参考 |
| Sub2API | `D:\CODE\external\_reference_gateway_sources\sub2api` | `main` | `f18451e5` | 账号可调度状态机、粘性清理、脱敏参考 |
| CLIProxyAPI | `D:\CODE\external\_reference_gateway_sources\CLIProxyAPI` | `main` | `3a54fb7f` | fill-first/round-robin、stream bootstrap retry 边界、Responses translator 参考 |

## Evidence Precedence

1. 本仓代码、focused tests、fixture monitor、release preflight。
2. 官方 OpenAI Codex 源码。
3. OpenAI 官方 API 文档。
4. 本地参考项目源码。
5. 社区/参考项目只提供结构启发，不覆盖本仓运行事实和官方语义。

## Official OpenAI Docs

| Doc | Relevant semantics | Cockpit implication |
| --- | --- | --- |
| [Responses Overview](https://developers.openai.com/api/reference/responses/overview) | Responses 是 stateful interface，可以用 previous responses 的 output 作为后续 input。 | continuation 是协议状态，不应被 Cockpit 用“换账号但复用同一上游状态”静默模拟。 |
| [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses) | HTTP streaming 使用 SSE typed events；常见生命周期事件包括 `response.created`、`response.output_text.delta`、`response.completed`、`error`。 | Cockpit 的 terminal 判断应显式区分 completed/error，而不是仅靠 TCP 结束或本地 JSON 拼接。 |
| [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | `previous_response_id` 用于 threaded conversation；WebSocket mode 使用同样语义；无法解析时应 full input context + `previous_response_id = null`。 | hard-affinity continuation 不应跨账号直接复用 `previous_response_id`；跨账号只能作为新 admission/full-context replay 边界处理。 |
| [Error codes](https://developers.openai.com/api/docs/guides/error-codes#websocket-mode-errors) | `previous_response_not_found` 要 full input context retry；429 要 pacing/backoff 并尊重 response headers；503 要指数退避并稳定速率。 | 默认低频、冷却、尊重 reset/headers、避免扫号和高频恢复探测是正确方向。 |

## Source Matrix

| Area | Source anchors | Finding | Cockpit status |
| --- | --- | --- | --- |
| Codex SSE terminal | `openai-codex/codex-rs/codex-api/src/sse/responses.rs:312`, `:358`, `:424`; `codex-rs/core/src/client.rs:1824` | 官方把 `response.failed` 作为 terminal error，只有 `response.completed` 才产出 completed；流关闭但未 completed 会报 `stream closed before response.completed`。 | 对齐：本仓 monitor 不把普通断流当作成功；`stream_completed`、`stream_error`、`final_response` 分开。 |
| Codex turn-scoped state | `openai-codex/codex-rs/core/src/client.rs:11`, `:231`, `:237`, `:243`, `:1070`, `:1087`; `codex-rs/core/tests/suite/client_websockets.rs:1845` | `ModelClientSession` 是 per-turn 状态，缓存 `x-codex-turn-state` 和 completed 后的 `previous_response_id`。error 后官方测试走 full create without previous_response_id。 | 对齐：本仓 hard-affinity continuation 不跨账号伪造；新 independent request 可避开 exhausted account。 |
| Stream write boundary | `src-tauri/src/modules/codex_local_access.rs:359`, `:374`, `:11038`, `:11070`, `:11387`, `:11472` | 本仓有 `StreamWriteState`，headers 或 first chunk 写出后 `can_attempt_account_fallback()` 为 false，并写审计事件。 | 已实现：本地不会在下游开始写出后切号续接同一响应。 |
| Upstream admitted boundary | `src-tauri/src/modules/codex_local_access.rs:12183` | 上游 response 到达后记录 `upstream_admitted`，并关联 model/account/request context。 | 已实现：monitor 能识别“已上游接纳”的 stream。 |
| Ordering regression guard | `src-tauri/src/modules/codex_local_access.rs:19070`, `:19105` | 单测等待并断言 `upstream_admitted <= headers_written <= first_chunk_written`。 | 已覆盖：防止“先耗尽再伪造 first chunk”一类审计顺序回归。 |
| Monitor continuity verdict | `scripts/monitor-live-codex-app-cockpit-acceptance.ps1:1796`, `:1802`, `:1808`, `:2990`, `:3005`, `:3387` | monitor 聚合 `upstream_admitted`、`headers_written`、`first_chunk_written`，对账号耗尽时的 in-flight stream 输出 pass/fail/blocked/skipped。 | 已覆盖：能回答用户关心的“耗尽信号出现前是否已经进入 headers/first chunk 写出”问题。 |
| Monitor fixture | `scripts/test-local-hardened-api-live-monitor.ps1:103`, `:105`, `:116`, `:128` | fixture 用离线 audit JSONL 验证 hard-affinity、accepted stream continuity、lineage 字段和 `x-codex-turn-state` 诊断。 | 已验证：不需要真实 drain 也能防 monitor 逻辑回归。 |
| Oversized request safety | `src-tauri/src/modules/codex_local_access.rs:9330`, `:9355`, `:13192`, `:22372` | 请求体过大时返回明确 `request_body_too_large`，避免长请求读入或含混 500。 | 已实现：API service 对大请求 fail-closed。 |
| Port conflict reuse | `src-tauri/src/modules/codex_local_access.rs:22475`, `:22543`, `:22551` | 有 healthy external listener 时复用，不写入持久端口漂移。 | 已实现：降低 watchdog/dev gateway 并存时的本机扰动。 |
| CLIProxyAPI stream retry | `CLIProxyAPI/config.example.yaml:141`; `sdk/api/handlers/handlers.go:734`, `:811`, `:814`; `sdk/cliproxy/auth/conductor.go:897`, `:934` | bootstrap retry 只允许在 first byte/payload 前；首字节后不能安全切换。 | 已采纳：本仓 stream write state 是同类边界，但默认更保守。 |
| CLIProxyAPI routing | `sdk/cliproxy/auth/selector.go:47`, `:112`, `:261`, `:360`; `sdk/cliproxy/auth/scheduler.go:819`, `:996`, `:1007` | 同时提供 round-robin 和 fill-first；model cooldown error 带 `Retry-After`；scheduler 区分 pickFirst/pickRoundRobin。 | 已采纳结构：Cockpit 默认避免 request-level random/round-robin，偏 sticky/fill-first。 |
| Sub2API schedulability | `backend/internal/service/account.go:116`; `backend/internal/service/gateway_service.go:494`, `:1459`; `backend/internal/repository/account_repo.go:1080`; `backend/internal/service/ratelimit_service.go:156` | 账号健康、rate-limit reset、temp unschedulable、model cooldown 进入统一可调度判断，sticky session 可被不可调度状态清理。 | 已采纳方向：health registry/cooldown 影响新 admission，不 retroactively cancel active stream。 |
| Sub2API redaction | `backend/internal/util/logredact/redact.go:50`, `:62`, `:86` | 结构化 map、JSON、文本脱敏独立实现。 | 已采纳原则：Cockpit audit 只记录 metadata/hash，不记录 prompt/token/header/body。 |
| LiteLLM local limiter | `litellm/proxy/hooks/parallel_request_limiter.py:73`, `:85`, `:100`, `:101`, `:128`, `:136` | pre-call 阶段检查并发/RPM/TPM，local 429 带 `retry-after`。 | 已采纳方向：local backpressure 与 upstream quota 429 分层。 |
| LiteLLM cooldown | `litellm/router_utils/cooldown_handlers.py:40`, `:98`; `litellm/router.py:7311`, `:7595`; `litellm/utils.py:6897`, `:6916` | cooldown 是独立策略面；并发安全的 pre-call RPM 检查发生在真正上游调用前；`Retry-After` 有专门解析路径。 | 已采纳方向：cooldown/retry/backpressure 不能只靠 status code 事后猜测。 |
| New API retry/disable | `new-api/common/constants.go:148`, `:153`; `controller/relay.go:233`, `:324`, `:360`; `service/channel.go:45`; `middleware/rate-limit.go:76`; `middleware/model-rate-limit.go:85` | 默认自动禁用 channel 关闭，默认 retry 为 0；shouldRetry/ShouldDisableChannel/限流是可配置层。 | 作为反证：成熟网关也不默认“429 就扫池”；Cockpit 自用默认保守是合理的。 |

## Answer To The Original Continuity Question

结论：在本仓当前代码和离线 fixture 范围内，可以保证 Cockpit API service 自身不会在 stream 已经 `upstream_admitted` 并进入 `headers_written`/`first_chunk_written` 后因为后续 `usage_limit_reached`、cooldown、fallback 或切号策略而主动改写/中断该 stream；monitor 也已经能显式判定“账号耗尽信号出现前是否满足 admitted + headers + first chunk”。

边界：这不是“让上游已返回 429 的请求继续生成”的保证。若上游在 admission 前就返回 `usage_limit_reached`，本地只能返回结构化 429、记录 cooldown，并让新独立请求避开耗尽账号。若真实上游在 first chunk 后仍中途断开，monitor 会给 `fail`、`blocked` 或 `open`，而不是把它包装成 pass。

## Code Change Assessment

本轮深度比对后没有发现必须新增的生产代码修复。此前相关提交已经覆盖主要缺口：

- `2ab83d47`：补齐 stream 上游接纳连续性监控。
- `d595057b`：强化 API service 端口复用与大请求响应。
- 后续 `63e526ae`、`004063e5`、`5c666828` 又补了配额救援、watchdog 证据、Free 周配额展示等邻近问题。

本轮需要补齐的是“审计证据可追溯”而不是继续扩大运行时行为。

## Verification Plan

本轮报告/文档改动应使用非 live 验证：

1. `git diff --check`
2. `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/test-local-hardened-api-live-monitor.ps1`
3. `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`
4. `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`

`npm run build` 与 full live upstream smoke 对本轮 docs/report-only 改动不是必要条件；此前代码改动已跑过 full build。本轮不执行真实 quota drain，按项目规则记为 live gate N/A：`reason=未获 AcknowledgeLiveUpstreamRisk 且真实 drain 会消耗账号池；alternative_verification=离线 audit fixture + Rust lib tests + release preflight；evidence_link=本报告与 test output；expires_at=下次明确授权 live drain 时`。

## Rollback

本报告是 docs/report-only。回滚方式：`git revert <commit>` 或删除 `reports/codex-api-service-source-audit/20260531-source-audit-matrix.md` 及对应 docs pointer；不涉及 live config、账号/provider、release exe 或持久状态。
