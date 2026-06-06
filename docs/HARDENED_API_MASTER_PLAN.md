# Hardened API Master Plan

状态：active
更新时间：2026-06-06

## 1. 作用

本文件是 Hardened API 相关文档的总控入口，负责三件事：

1. 定义文档分工。
2. 固定关键术语和语义。
3. 给出当前执行焦点和剩余高价值缺口。

如果局部专项文档之间出现表述冲突，以本文件的“语义合同”和产品级 PRD 为准，然后再回写局部文档。

产品级源头见 [HARDENED_API_PRODUCT_REQUIREMENTS.md](/D:/CODE/external/Cockpit-Tools-Local/docs/HARDENED_API_PRODUCT_REQUIREMENTS.md)。

## 2. 文档角色

| 文档 | 角色 | 什么时候看 |
| --- | --- | --- |
| `HARDENED_API_PRODUCT_REQUIREMENTS.md` | 产品合同 | 判断“要不要做、做成什么算成功” |
| `HARDENED_API_MASTER_PLAN.md` | 总控导航与语义合同 | 判断“哪份文档才是当前权威入口” |
| `LOCAL_HARDENED_API_ROADMAP.md` | 总体阶段路线图 | 判断当前在哪个阶段、下一阶段是什么 |
| `LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md` | 实施任务清单 | 实际写代码和安排切片时使用 |
| `LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md` | 调度专项 | 账号池、selector、fallback、pool_unavailable 相关修改 |
| `ACCOUNT_RISK_CONTROL_REFRESH_HARDENING_PLAN.md` | 刷新专项 | quota refresh、tray refresh、当前账号自动刷新相关修改 |
| `LOCAL_HARDENED_API_PERFORMANCE_PLAN.md` | 性能专项 | 启动、轮询、切换、刷新等性能问题 |
| `LOCAL_HARDENED_API_CODEX_RESPONSES_PROTOCOL.md` | Codex-facing 协议附录 | 判断 `pool_unavailable`、local completed Responses、hard-affinity 是否符合合同 |
| `LOCAL_HARDENED_API_ACCEPTANCE_MATRIX.md` | 用户旅程验收矩阵 | 判断当前改动是否真正通过产品级验收 |
| `LOCAL_HARDENED_API.md` | 运行手册 | 手工验证、日常操作、smoke 执行 |
| `reference-sources.md` | 参考源码索引 | 查本地参考仓库路径和 revision |
| `reference-gateway-best-practices.md` | 结构化审查与参考依据 | 对照官方/社区网关证据时使用 |

## 3. 关键语义合同

### 3.1 Hard Affinity

以下信号构成 hard affinity，不允许静默跨账号续接：

- `previous_response_id`
- `x-codex-turn-state`

### 3.2 Metadata-only Lineage

以下信号只用于 lineage / observability，不构成 hard affinity：

- `x-codex-turn-metadata`
- `x-codex-turn-metadata.turn_id`
- `x-client-request-id`

### 3.3 Same-request Rescue

“同请求补救”只在以下条件同时满足时允许：

- 当前请求还没有向下游写出 headers 或首个 payload
- 不属于 hard-affinity continuation
- 错误被 classifier 判定为 failover-safe
- 仍在本次请求预算内
- 实际尝试账号数不超过 `maxRetryAccounts`

这件事不等价于“允许当前任务自由切号”。

### 3.4 Next-request Reselection

“下一个请求重新选号”是默认产品能力。它的作用对象是新的独立请求，而不是已经进入 hard-affinity 的同一任务。

### 3.5 `fallbackMode`

当前字段名 `fallbackMode` 仍保留，但其规范语义应理解为：

- 它控制“当前请求完成后，后续独立请求是否重新选择账号”的策略。
- 它本身不单独授权 hard-affinity 请求跨账号。
- 它本身也不等于 same-request rescue；same-request rescue 由 classifier、stream guard、`maxRetryAccounts` 和请求预算共同决定。

这是当前实现与文档最容易混淆的地方。后续若重构配置命名，应优先拆成更清晰的三段式配置。

### 3.6 `pool_unavailable`

`pool_unavailable` 对不同客户端是不同合同：

- 普通 HTTP 客户端：返回本地 `503/pool_unavailable` JSON + `Retry-After`
- Codex-facing `/v1/responses`：先在请求预算内短等待；若仍不可恢复，则返回本地 completed Responses SSE/JSON 闭合

禁止把 Codex-facing 的全池不可用降级成：

- transport 503
- `response.failed`
- heartbeat-only open wait
- parked idle SSE
- 静默断线

### 3.7 Active Stream Lease

一旦请求已经被上游接纳并开始向下游写出：

- health registry / cooldown 变化只能影响新 admission
- 不能 retroactively cancel 当前 active stream
- 只能等它自然 terminal、客户端断开、或 transport fatal error

## 4. 当前执行状态

### 已经相对明确的部分

- 方向：Cockpit 作为控制面、官方 `openai-codex` 为最高语义锚点、低并发低刷新优先
- 结构：路线图、实施计划、调度专项、刷新专项、协议附录、验收矩阵、运行手册已成体系
- 证据：本地参考源码目录、focused tests、smoke/report 入口已经存在

### 仍然需要增强的部分

1. 产品级成功指标刚刚补齐，后续需要把它们映射进各专项验收。
2. 性能计划仍需要真实基线样本和阶段性复测报告。
3. Windows-first 与跨平台支持边界还没有写成发布级语义。
4. 部分 UI/人工恢复场景的自动化验收仍偏弱。

## 5. 推荐下一优先级

### Priority A

- 把 `fallbackMode` / same-request rescue / next-request reselection 语义同步回所有局部文档
- 用真实报告验证新性能阈值

### Priority B

- 把用户旅程矩阵映射到 release acceptance summary
- 补 Windows-first / cross-platform 发布语义

### Priority C

- 未来如配置复杂度继续升高，再把 `fallbackMode` 字段拆名

## 6. 验收入口

最小统一门禁：

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
3. `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`
4. hotspot review：`SECURITY.md`、`src-tauri/capabilities/`、updater、quota/cooldown/pool routing、i18n、live continuity

辅助入口：

- `scripts/smoke-local-hardened-api.ps1`
- `scripts/accept-local-hardened-api-continuity.ps1`
- `scripts/test-local-hardened-api-live-monitor.ps1`
- `scripts/test-local-hardened-api-live-risk-guard.ps1`
- `scripts/update-reference-snapshots.ps1`

## 7. 当前开放问题

1. `Codex-facing local completed Responses` 是否长期保留为正式合同。
2. Windows-first 与跨平台同权支持的边界如何写入发布语义。
3. 新性能阈值是否需要按 50 账号 / 200 账号两档分别固化到 release report。
