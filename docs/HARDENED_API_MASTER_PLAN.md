# Hardened API Master Plan

状态：active
更新时间：2026-06-07

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
| `COCKPIT_LOCAL_TARGET_ARCHITECTURE.md` | 项目目标架构蓝图 | 判断最终应收敛成什么形态、技术栈和层次边界 |
| `HARDENED_API_PRODUCT_REQUIREMENTS.md` | 产品合同 | 判断“要不要做、做成什么算成功” |
| `HARDENED_API_MASTER_PLAN.md` | 总控导航与语义合同 | 判断“哪份文档才是当前权威入口” |
| `LOCAL_HARDENED_API_ROADMAP.md` | 总体阶段路线图 | 判断当前在哪个阶段、下一阶段是什么 |
| `LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md` | 实施任务清单 | 实际写代码和安排切片时使用 |
| `LOCAL_HARDENED_API_NEXT_PHASE_BACKLOG.md` | 下一阶段 backlog | 收口暂不阻塞当前蓝图、但必须继续澄清的问题 |
| `LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md` | 调度专项 | 账号池、selector、fallback、pool_unavailable 相关修改 |
| `ACCOUNT_RISK_CONTROL_REFRESH_HARDENING_PLAN.md` | 刷新专项 | quota refresh、tray refresh、当前账号自动刷新相关修改 |
| `LOCAL_HARDENED_API_PERFORMANCE_PLAN.md` | 性能专项 | 启动、轮询、切换、刷新等性能问题 |
| `LOCAL_HARDENED_API_CODEX_RESPONSES_PROTOCOL.md` | Codex-facing 协议附录 | 判断 `pool_unavailable`、local completed Responses、hard-affinity 是否符合合同 |
| `LOCAL_HARDENED_API_ACCEPTANCE_MATRIX.md` | 用户旅程验收矩阵 | 判断当前改动是否真正通过产品级验收 |
| `LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md` | release 收口读表 | 判断本轮 release 到底该看哪些 gate、证据和 blocker |
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

### 3.5.1 统一术语对照

| 术语 | 作用对象 | 当前是否正式语义 | 约束入口 |
| --- | --- | --- | --- |
| `hard affinity` | 同一 Codex turn / continuation | 是 | `previous_response_id`、`x-codex-turn-state`；禁止静默跨账号 |
| `same-request rescue` | 当前尚未写出的同一次请求 | 是 | classifier + stream guard + `maxRetryAccounts` + 请求预算 |
| `next-request reselection` | 当前请求结束后的新独立请求 | 是 | selector / health registry / cooldown / `fallbackMode` |
| `fallbackMode` | 只影响“下一请求是否重新选号”的策略开关 | 是，但字段名偏历史 | 不单独授权 hard-affinity，也不等于 same-request rescue |

### 3.5.2 配置命名草案

当前实现继续保留 `fallbackMode` 字段以维持兼容；若后续需要真正拆名，推荐语义草案是：

- `sameRequestRescuePolicy`：明确描述“当前请求在 failover-safe 条件下是否允许有限补救”。
- `nextRequestReselectionPolicy`：明确描述“当前请求结束后，新独立请求如何重新选择账号”。
- `hardAffinityPolicy`：继续显式表达 continuation 不跨账号的硬边界。

在真正迁移前，所有 UI、文档、release summary 都应把 `fallbackMode` 解释成 `next-request reselection` 的历史字段，而不是“当前请求切号策略”。

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

### 3.8 Loopback Default / Advanced LAN

- hardened 默认和当前运行手册只覆盖 `127.0.0.1` loopback。
- `lan_base_url` 只是兼容字段，不构成默认推荐入口。
- 如未来支持 LAN 监听，也只能作为高级显式 opt-in，必须带风险提示、hotspot review、回滚入口和独立 release acceptance；公网开放不在范围内。

## 4. 当前执行状态

### 已经相对明确的部分

- 整体终态：项目级目标架构蓝图已明确“桌面控制面 + 本地 Hardened Runtime + 可选兼容桥接”的收敛方向
- 方向：Cockpit 作为控制面、官方 `openai-codex` 为最高语义锚点、低并发低刷新优先
- 结构：路线图、实施计划、调度专项、刷新专项、协议附录、验收矩阵、运行手册已成体系
- release 收口：`LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md` 已把 U1-U10、release gate、Windows-first 发布语义和 blocker 统一收口
- 证据：本地参考源码目录、focused tests、smoke/report 入口已经存在

### 仍然需要增强的部分

1. `fallbackMode` / same-request rescue / next-request reselection / loopback default 语义仍需持续同步回局部文档和 UI。
2. 性能计划仍需要真实基线样本和阶段性复测报告。
3. 部分 live Tauri/tray/系统通知场景的自动化验收仍偏弱。
4. 高级显式 LAN 模式是否进入正式 release 合同，仍需单独决策。

## 5. 推荐下一优先级

### Priority A

- 把 `fallbackMode` / same-request rescue / next-request reselection 语义同步回所有局部文档
- 把“默认 loopback / 高级显式 LAN opt-in”语义同步回所有局部文档
- 用真实报告验证新性能阈值

### Priority B

- 用真实基线报告补齐 release acceptance summary 中的 U10 证据
- 若未来要提升非 Windows 交付等级，再把 macOS/Linux 从“兼容级”升级为独立 release 合同

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
2. 新性能阈值是否需要按 50 账号 / 200 账号两档分别固化到 release report。
3. 高级显式 LAN 模式是否需要成为正式 release 合同，以及它与 hardened 默认之间的边界如何落文档和验收。
