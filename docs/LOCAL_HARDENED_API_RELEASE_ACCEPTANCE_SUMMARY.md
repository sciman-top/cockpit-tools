# Local Hardened API Release Acceptance Summary

状态：active
更新时间：2026-06-07

## 1. 作用

本文件把产品级用户旅程、专项计划、release preflight、browser-preview smoke、focused tests 和高风险 acceptance 入口收成一张 release 读表。它回答三个问题：

1. 哪些门禁是每次 release 都必须过的。
2. U1-U10 各自该看什么证据，失败/阻断信号是什么。
3. Windows-first / cross-platform 在当前自用版里到底按什么语义发布。

产品合同见 `docs/HARDENED_API_PRODUCT_REQUIREMENTS.md`，总控入口见 `docs/HARDENED_API_MASTER_PLAN.md`，用户旅程定义见 `docs/LOCAL_HARDENED_API_ACCEPTANCE_MATRIX.md`。

## 2. Release 姿态

### 2.1 产品与网络边界

- 当前 release 姿态是：`Windows-first` 自用桌面控制面 + 默认只监听 `127.0.0.1` 的本地 Hardened API Runtime。
- hardened 默认路径只覆盖 loopback；LAN 监听只能是高级显式 opt-in，不能被 release notes 写成默认推荐入口。
- Codex-facing 语义以本仓运行事实、OpenAI 官方文档、`openai-codex` 源码和本地 focused tests 为最高锚点。

### 2.2 平台分级

| 平台 | 当前发布语义 | 阻断标准 |
| --- | --- | --- |
| Windows | 一级体验目标；必须对桌面控制面、本地 runtime、loopback 安全边界、provider projection、acceptance 证据负责 | 任何破坏 U1/U2/U4/U5/U6/U7/U8 主合同的回归都阻断 |
| macOS | 兼容级目标；Rust domain/runtime 尽量可移植，但当前自用 release 不要求同等桌面体验承诺 | 若引入明确平台特有回归或破坏核心源码兼容，应阻断；否则不以“缺少同等 UI/托盘验证”阻断 Windows 自用版 release |
| Linux | 兼容级目标；与 macOS 同口径 | 同上 |

### 2.3 自用版发布语义

- release 只发布自用版构建产物，不镜像官方安装资产。
- app 版本继续使用 `official-base + -local.N` 语义，避免与官方原版混淆。
- updater、capability、shell/process、provider/auth/live runtime continuity 仍属于高影响面，必须带回滚路径和证据。

## 3. 统一门禁

### 3.1 每次 release 必跑

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test
git diff --check
```

### 3.2 Hotspot review

每次 release 还必须单独复核：

- `SECURITY.md`
- `src-tauri/capabilities/`
- updater / signing / release scripts
- quota / cooldown / pool routing / continuity
- i18n 文案
- live continuity 风险边界

## 4. 用户旅程到 Release Gate

| ID | 旅程 | Release 必要证据 | 默认入口 | 阻断信号 |
| --- | --- | --- | --- | --- |
| U1 | 单账号稳定执行 | build + Rust lib tests + preflight；必要时补 `single` smoke / CLI 直连证据 | `npm run build` / `cargo test ... --lib` / `scripts/smoke-local-hardened-api.ps1 -Stage single` | 默认 LAN 误导、敏感 DOM/log 泄露、单账号路径出现无根据 fallback |
| U2 | 小池安全切换 | small-pool / fallback focused tests 或历史 smoke 报告；selector/cooldown 行为必须可解释 | `scripts/smoke-local-hardened-api.ps1 -Stage small_pool`；调度 focused tests | 新独立请求扫完整池、request-level random routing、同任务静默跨账号 |
| U3 | 人工可恢复 | browser-preview UI smoke + recovery focused tests | `reports/local-hardened-api-smoke/browser-preview-ui-smoke-20260607.md` | UI 解释不到 blocked reason / recover action；恢复动作打真实上游 |
| U4 | Direct / Local 往返切换 | app-safe isolated probe、continuity script、配置/进程/hash 未破坏证据 | `scripts/accept-local-hardened-api-continuity.ps1` 或 continuity probe | 修改 live `~/.codex`、破坏当前 App/CLI 连续性、需要重启/kill 才成立 |
| U5 | 自用版安全发布 | preflight + hotspot review + 自用版发布语义说明 | `node scripts/release/preflight.cjs ...` + `docs/SELF_USE_DELTA.md` | capability 扩权、updater/signing 语义不清、无回滚路径、发布口径把自用版写成官方版 |
| U6 | Codex-facing 全池不可用闭合 | Responses 协议 focused tests + continuity / monitor 证据 | `docs/LOCAL_HARDENED_API_CODEX_RESPONSES_PROTOCOL.md` 中列出的 tests；continuity/monitor scripts | transport `503/pool_unavailable`、`response.failed`、heartbeat-only wait、静默断线 |
| U7 | Hard-affinity 不跨账号续接 | hard-affinity focused tests + acceptance/monitor 脚本 | `previous_response_id_*` / `hard_affinity_*` focused tests | `previous_response_id` 或 `x-codex-turn-state` continuation 被静默切到新账号 |
| U8 | 默认低风控姿态 | preflight risk guard + refresh guard + preset review | `scripts/test-local-hardened-api-live-risk-guard.ps1` / `scripts/test-refresh-risk-guard.cjs` | 高频 live probe、默认 2 分钟刷新、批量 OAuth 池探测、扩大真实上游消耗 |
| U9 | 可解释的账号选择 | browser-preview explainability smoke + selector tests | `reports/local-hardened-api-smoke/browser-preview-ui-smoke-20260607.md` | UI 只剩结果没有理由；日志或 UI 暴露完整邮箱、key、账号 ID |
| U10 | 性能不拖慢主流程 | 性能专项计划中的 baseline/report；当前至少要有 isolated `M` 档基线，并持续补 app-safe/live 基线 | `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/measure-local-hardened-api-performance.ps1` + `docs/LOCAL_HARDENED_API_PERFORMANCE_PLAN.md` + `reports/local-hardened-api-performance/` | lightweight polling、启动、切换或刷新在 `M` 档明显超阈值，导致主路径卡顿 |

### 4.1 `fallbackMode` / rescue / reselection 对照

| 概念 | release 应怎么读 | 不应该怎么读 | 当前证据入口 |
| --- | --- | --- | --- |
| `fallbackMode` | 历史字段名；当前只表示“后续独立请求是否重新选号” | 误读成“当前请求可自由切号” | `docs/HARDENED_API_MASTER_PLAN.md`、`docs/LOCAL_HARDENED_API.md` |
| `same-request rescue` | 仅限未写出前、failover-safe、预算内的有限补救 | 误读成 hard-affinity continuation 可跨账号续接 | `docs/HARDENED_API_PRODUCT_REQUIREMENTS.md`、focused tests、`fallback_probe` 报告 |
| `next-request reselection` | 新独立请求可避开 cooldown/exhausted 账号重新选号 | 误读成对当前任务的静默重放 | selector focused tests、small-pool / fallback reports |
| `hard affinity` | 同任务 continuation 不跨账号，必要时阻断或本地闭合 | 用 `x-client-request-id` 或 metadata-only 字段升级成 hard-affinity | hard-affinity focused tests、continuity / monitor 脚本 |

## 5. 当前可复用证据入口

### 5.1 低风险默认 UI / 浏览器证据

- `reports/local-hardened-api-smoke/browser-preview-ui-smoke-20260607.md`
  - 已覆盖 API service key/client key DOM 脱敏
  - 已覆盖 health panel、modal 与首页 inline card explainability
- `reports/local-hardened-api-smoke/recent-audit-ui-contract-20260607.md`
  - 已覆盖 recent audit 脱敏事件摘要合同
  - 已确认默认视图保持聚合状态 + 最近事件，不展开账号级 health 细节
- `reports/local-hardened-api-smoke/browser-preview-wakeup-ui-smoke-20260607.md`
  - 已覆盖 wakeup/reset 默认 UI、startup delay 预览和邮箱/title 脱敏

### 5.2 协议与连续性入口

- `scripts/accept-local-hardened-api-continuity.ps1`
- `scripts/test-local-hardened-api-live-monitor.ps1`
- `scripts/test-codex-api-service-continuity-focus.ps1`
- `docs/LOCAL_HARDENED_API_CODEX_RESPONSES_PROTOCOL.md`

### 5.3 风险控制入口

- `scripts/test-local-hardened-api-live-risk-guard.ps1`
- `scripts/test-refresh-risk-guard.cjs`
- `docs/SELF_USE_DELTA.md`
- `docs/UPSTREAM_SYNC_POLICY.md`

### 5.4 历史 acceptance / smoke 示例

- `reports/local-hardened-api-acceptance/20260520-215349/accept.stdout.json`
- `reports/local-hardened-api-realrun/accept-drain-20260528-211516/accept-meta.json`

这些历史文件主要用于说明 acceptance/realrun 的证据形态；是否可以直接复用，仍要看本轮改动影响面。

### 5.5 性能基线入口

- `scripts/measure-local-hardened-api-performance.ps1`
- `reports/local-hardened-api-performance/perf-baseline-20260607-202512.md`
- `reports/local-hardened-api-performance/perf-baseline-20260607-202512.json`

当前已形成 `U10 / NPB-03` 的首份 isolated synthetic `M/L` 基线；剩余缺口是 live tray / 系统通知 / runtime switch / modal 首次打开等 app-safe 真实交互证据。

## 6. 阻断规则

以下任一命中，都应视为 release blocker，而不是“还有点小问题”：

1. Codex-facing `/v1/responses` 出现 transport `503/pool_unavailable`、`response.failed`、heartbeat-only open wait 或静默断线。
2. hard-affinity continuation 静默跨账号。
3. 默认路径重新引入高频 live probe、批量 OAuth quota refresh、请求级随机轮转或扩大真实上游消耗。
4. UI、日志、审计或 DOM `title` 暴露完整 key、token、邮箱、prompt 或 response。
5. updater、capability、provider/auth projection 或 live continuity 没有清楚回滚口径。
6. Windows 一级体验主路径在 `M` 档下出现明显卡顿，但没有足够证据说明只是历史基线未校准。

## 7. N/A 与 Waiver 口径

- 纯文档/纯注释/纯排版切片可以按项目规则记录 `gate_na`，但不能伪装成已通过 live acceptance。
- 缺少 live 上游授权、不能动当前 Cockpit/Codex 运行态、或本机无目标平台时，可记录 `platform_na`。
- 所有 N/A / waiver 都必须记录：
  - `reason`
  - `alternative_verification`
  - `evidence_link`
  - `expires_at`

## 8. 当前收口判断

截至 2026-06-07，当前 release 收口状态是：

- U3 / U9 / wakeup-reset 默认 UI 已有 browser-preview + AI 审查证据。
- U5 的 Windows-first / 自用版发布语义已可以通过本文件、`docs/SELF_USE_DELTA.md` 和 preflight/hotspot review 统一判定。
- U10 已补首份 isolated synthetic baseline/report，当前指标在 `M/L` 档均低于阈值。
- live Tauri tray / 系统通知 / live continuity 仍属高风险场景，不能被 browser-preview 假装覆盖，只能继续走 app-safe probe 或显式 live acceptance。
- U10 剩余缺口已从“完全缺 baseline”收敛为“仍缺 live / app-safe 真实交互基线”，这仍需要后续补证据，但不再是零起点。
