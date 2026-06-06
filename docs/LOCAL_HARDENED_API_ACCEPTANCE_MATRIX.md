# Local Hardened API Acceptance Matrix

状态：active
更新时间：2026-06-06

## 1. 目的

本文件把产品级 PRD 中的一级用户场景，映射成可以重复执行、可以判定 pass/fail/blocked 的验收矩阵。它不是实现计划，而是“交付算不算成功”的统一读表入口。

产品合同见 `docs/HARDENED_API_PRODUCT_REQUIREMENTS.md`，总控入口见 `docs/HARDENED_API_MASTER_PLAN.md`。

## 2. 判定规则

- `pass`：满足主要用户结果，且无关键连续性/安全回归。
- `fail`：出现明确违背合同的输出，例如 hard-affinity 静默跨账号、Codex-facing `response.failed/pool_unavailable`、泄露敏感信息。
- `blocked`：当前 run 没有触发目标场景，或缺少必要前置条件，不能拿来冒充通过。

## 3. 产品级旅程矩阵

| ID | 用户旅程 | 前置条件 | 关键动作 | Pass 证据 | Fail 信号 | 默认入口 |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | 单账号稳定执行 | API service 已启用；号池恰好 1 个账号 | 跑一次 single smoke，必要时加一次真实上游请求 | loopback/auth/models/health/audit 全通过；无 LAN 误导；无敏感日志 | DOM title 暴露 key；返回伪 LAN 推荐；单账号路径出现无根据 fallback | `scripts/smoke-local-hardened-api.ps1 -Stage single` |
| U2 | 小池安全切换 | 号池 2-3 个账号；health registry 可用 | 先让 1 个账号进入 cooldown/exhausted，再发新 independent request | 新请求避开不可调度账号；`attempted_account_count` 受 cap 限制；无 request-level random routing | 同任务静默跨账号；为了找账号扫完整池；`maxRetryAccounts` 失控 | `scripts/smoke-local-hardened-api.ps1 -Stage small_pool` |
| U3 | 人工可恢复 | health panel 与 recovery 已启用 | 让账号进入 cooldown/manual 状态，再执行恢复/暂停 | UI 能解释原因；恢复动作不打上游；audit 有脱敏恢复事件 | 只剩 transport error；恢复动作触发真实 quota probe；暴露账号敏感信息 | focused tests + health panel smoke |
| U4 | Direct / Local 往返切换 | 当前 Codex/Cockpit live continuity 受保护 | 用临时配置或旁路探针切换，再恢复 | live CLI config/auth hash untouched；App 进程稳定；provider 投影正确 | 改动 live `~/.codex`；重启/kill 现有 App；会话历史不可见 | app-safe isolated probe / continuity script |
| U5 | 自用版安全发布 | updater/capability/release 文档齐备 | 跑 release preflight 与 hotspot review | capability 未扩权；updater 语义清楚；有回滚路径 | 静默扩大 shell/fs/updater 暴露面；无回滚 | `node scripts/release/preflight.cjs ...` |
| U6 | Codex-facing 全池不可用闭合 | Independent admission；全池不可调度 | 触发 `pool_unavailable` | independent request 得到本地 completed SSE/JSON 闭合；有 assistant text 与 recover_action | transport 503、`response.failed`、heartbeat-only wait、静默断线 | continuity script + live monitor |
| U7 | Hard-affinity 不跨账号续接 | 请求带 `previous_response_id` 或 `x-codex-turn-state` | 原账号触发 quota/cooldown | 只允许原账号短等待或显式 terminal error；无跨账号复用旧 continuation | `fallback_blocked` 后被标记 pass；跨账号复用旧 `previous_response_id` | continuity script + focused Rust tests |
| U8 | 默认低风控姿态 | balanced/self-use preset | 连续触发多次请求、刷新和状态读取 | 无高频 live probe；无全池扫射；refresh 不批量探测 OAuth 池 | 自动 2 分钟高频刷新；新账号因 100% 周额度强行压过已恢复老账号 | preset + refresh guard tests |
| U9 | 可解释的账号选择 | selector audit 已启用 | 发起多次 admission | audit 能解释 selected/skipped/cap reasons；UI 能看懂 blocked reason | 只有最终 hash，没有原因；日志混入完整邮箱/账号 ID | selector tests + UI summary |
| U10 | 性能不拖慢主流程 | telemetry/lightweight state 已启用 | 打开 modal、轮询、切换、刷新 | 达到性能计划阈值；无明显 UI 卡死 | full state 轮询拖死 UI；同模式切换仍全量 materialize | `docs/LOCAL_HARDENED_API_PERFORMANCE_PLAN.md` 对应测量 |

## 4. 场景到脚本/门禁映射

### 4.1 默认静态门禁

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test
```

### 4.2 API service smoke

```powershell
.\scripts\smoke-local-hardened-api.ps1 -Stage single -StartEphemeralGateway -WriteReport
.\scripts\smoke-local-hardened-api.ps1 -Stage small_pool -StartEphemeralGateway -WriteReport
```

### 4.3 连续性高价值验收

```powershell
.\scripts\accept-local-hardened-api-continuity.ps1 -Model gpt-5.5 -AcknowledgeLiveUpstreamRisk -SkipEphemeralGatewayBuild
.\scripts\monitor-live-codex-app-cockpit-acceptance.ps1 -DurationSeconds 900 -RequireQuotaFallback -RequireStreamCompletion -RequireCliConfigUntouched -RequireAppStable -WriteReport
```

## 5. 必须单独看待的失败信号

以下情况不能被“整体还行”掩盖：

- hard-affinity 请求静默跨账号续接
- Codex-facing `/v1/responses` 出现 transport `503/pool_unavailable`
- `response.failed/pool_unavailable`
- heartbeat-only open wait / parked SSE idle
- 本地 completed 被误判为 upstream success
- UI / audit / report 暴露完整 key、token、邮箱、prompt 或 response

## 6. 当前缺口

1. U10 的性能阈值刚补齐，需要用真实基线报告验证。
2. U3、U9 仍依赖部分 UI smoke，自动化程度低于 Rust/script gates。
3. U5 的 Windows-first 发布语义仍需与正式 release 说明完全对齐。
