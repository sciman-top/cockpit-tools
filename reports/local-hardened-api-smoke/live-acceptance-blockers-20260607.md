# Live Acceptance Blockers - 2026-06-07

状态：blocked
时间：2026-06-07 Asia/Shanghai
目标：在不打断当前 `Codex App` / `Cockpit` 会话的前提下，明确 `NPB-06` 与 `NPB-03` 剩余 live 验收为何当前不能继续自动完成，并给出下次可安全执行的前置条件。

## 1. 前提

- 当前约束：用户已允许继续 live 验证，但前提是当前 `Codex App` 不断线、本会话持续。
- 禁止动作：不重启、不 kill、不自动拉起当前 `Codex App`、`codex`、`Cockpit Tools`；不改 `~/.codex/config.toml`、`~/.codex/auth.json`。
- 当前 live 配置文件：`C:\Users\sciman\.antigravity_cockpit\codex_local_access.json`
- 关联证据：
  - `reports/local-hardened-api-smoke/live-ui-smoke-readonly-baseline-20260607.md`
  - `reports/local-hardened-api-live-monitor/live-monitor-20260607-231751.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-001034.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-001821.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-002746.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-002810.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-003000.json`

## 2. 当前现场事实

### 2.1 live runtime

只读探针与 monitor 一致显示：

- `enabled = false`
- `accessScope = lan`
- `gatewayMode = sidecar`
- `routingStrategy = custom`
- `accountIds = []`
- `runtimeMode.mode = direct_projection`
- `apiServiceRuntime.available = false`
- `listenerCount = 0`

结论：当前 live API service 并未运行，也没有 listener 可供真实 tray / 系统通知 / live continuity 提示验收复用。

### 2.1.1 隔离 listener 旁路事实

2026-06-08 追加执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-local-hardened-api.ps1 -Stage single -StartEphemeralGateway -AppSafeIsolatedProbe -AssertCodexCliConfigUntouched -AssertCodexAppProcessStable -WriteReport
```

关键结果见 `reports/local-hardened-api-smoke/smoke-20260608-001034.json`：

- `ephemeralGateway.ready.statusCode = 200`
- `loopback_models_endpoint = pass`
- `invalid_key_auth_guard = pass`
- `codex_cli_config_auth_untouched = pass`
- `codex_app_process_stable = pass`

结论：`enabled=false` 与 `listenerCount=0` 只说明“当前 live 现场未启用”，不等于项目没有无扰动 listener 验证路径。隔离 `ephemeral gateway` 已证明旁路 listener 可以在不改当前 `~/.codex`、不破坏当前 `Codex App` 进程稳定性的前提下成功拉起。

### 2.1.2 号池成员前置条件

同一份隔离 smoke 同时显示：

- `routing.candidate_pool_count = 0`
- `config_single_contract.reason = "single 阶段要求 accountIds 恰好为 1"`
- 当前 live `codex_local_access.json` 中 `accountIds = []`

后续继续执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-local-hardened-api.ps1 -Stage fallback_probe -StartEphemeralGateway -TemporaryFallbackConfig -AppSafeIsolatedProbe -AssertCodexCliConfigUntouched -AssertCodexAppProcessStable -WriteReport
```

脚本直接在 `Set-TemporaryFallbackProbeConfig` 阶段抛错：

- `fallback_probe 需要至少 1 个手动配置的 API 服务号池账号，当前 accountCount=0`

结论：当前 continuity / fallback acceptance 的直接脚本阻塞不仅是 live listener 未启用，更是“当前 API 服务号池没有任何手动成员”。

### 2.1.3 单账号隔离合同已通过

在用户补入 1 个 API 服务号池成员后，2026-06-08 继续执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-local-hardened-api.ps1 -Stage single -StartEphemeralGateway -AppSafeIsolatedProbe -AssertCodexCliConfigUntouched -AssertCodexAppProcessStable -WriteReport
```

关键结果见 `reports/local-hardened-api-smoke/smoke-20260608-001821.json`：

- `overall = pass`
- `config_single_contract = pass`
- `routing.candidate_pool_count = 1`
- `loopback_models_endpoint = pass`
- `invalid_key_auth_guard = pass`
- `codex_cli_config_auth_untouched = pass`
- `codex_app_process_stable = pass`

结论：当前仓库已经证明，单账号 API 服务号池下的隔离 listener、loopback contract、API key guard、CLI 配置守卫与 App 进程守卫都可以在不打断当前 `Codex App` 会话的前提下通过。

### 2.1.4 `fallback_probe` 已推进到显式上游门槛

在用户补入 1 个号池成员后，2026-06-08 继续执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-local-hardened-api.ps1 -Stage fallback_probe -StartEphemeralGateway -TemporaryFallbackConfig -AppSafeIsolatedProbe -AssertCodexCliConfigUntouched -AssertCodexAppProcessStable -WriteReport
```

关键结果见 `reports/local-hardened-api-smoke/smoke-20260608-002746.json`：

- `temporaryFallbackConfig.accountCount = 1`
- `ephemeralGateway.ready.statusCode = 200`
- `config_fallback_probe_contract.reason = "fallback_probe 需要显式 -RunUpstreamSmoke 或 -RunCodexExecSmoke 才能验证真实上游 fallback 边界"`
- `codex_cli_config_auth_untouched = pass`
- `codex_app_process_stable = pass`

结论：当前 `fallback_probe` 已不再被“没有号池成员”阻塞，已经推进到“是否显式允许真实上游请求”的门槛。

### 2.1.5 `small_pool` 仍未满足

2026-06-08 再执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-local-hardened-api.ps1 -Stage small_pool -StartEphemeralGateway -AppSafeIsolatedProbe -AssertCodexCliConfigUntouched -AssertCodexAppProcessStable -WriteReport
```

关键结果见 `reports/local-hardened-api-smoke/smoke-20260608-002810.json`：

- `config_small_pool_contract.reason = "small_pool 阶段要求 accountIds 为 2 到 3 个"`
- `routing.candidate_pool_count = 1`
- `codex_cli_config_auth_untouched = pass`
- `codex_app_process_stable = pass`

结论：若目标是验证 `new_request_avoids_exhausted_account` 这类“旧账号耗尽后新请求切到健康账号”的 continuity/fallback 主合同，当前仍缺第 2 个号池成员。

### 2.1.6 单账号真实上游 smoke 当前未通过

在用户确认 live upstream 风险后，2026-06-08 继续执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-local-hardened-api.ps1 -Stage single -StartEphemeralGateway -AppSafeIsolatedProbe -AcknowledgeLiveUpstreamRisk -RunUpstreamSmoke -Expect429 -AssertCodexCliConfigUntouched -AssertCodexAppProcessStable -WriteReport
```

关键结果见 `reports/local-hardened-api-smoke/smoke-20260608-003000.json`：

- `single_account_upstream_chat = fail`
- `reason = "真实上游请求异常"`
- `evidence.error = "An error occurred while sending the request."`
- `audit.phases = ["local_access_enabled_transition"]`
- `routing.attempted_account_count = 0`
- `codex_cli_config_auth_untouched = pass`
- `codex_app_process_stable = pass`

结论：当前单账号 live upstream 路径还不能宣称通过。失败发生在请求发送层之前或刚起步阶段，未形成可用于 continuity/fallback 判断的 audit 证据，因此不应仅靠重复重试继续消耗真实上游额度。

### 2.2 连续性护栏

执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/monitor-live-codex-app-cockpit-acceptance.ps1 -DurationSeconds 20 -PollIntervalSeconds 2 -RequireCliConfigUntouched -RequireAppStable -WriteReport -Quiet
```

关键结果：

- `overall = pass`
- `codexCliGuard.comparison.unchanged = true`
- `codexAppGuard.comparison.stable = true`

结论：只读证据已证明本轮没有碰 live CLI/App 配置和进程稳定性；同样也意味着后续若要做真实 live 验收，必须继续保持这两条守卫。

### 2.3 桌面观察能力

当前会话没有可直接复核系统托盘菜单与原生通知弹窗的可信桌面抓取/断言工具；browser-preview 不能替代 OS 级 tray / notification 观察。

## 3. 阻塞判断

### 3.1 `NPB-06` real UI smoke

以下项目当前不能诚实标记为完成：

1. tray 菜单交互
2. 系统通知弹出与动作回调
3. live continuity 提示

原因：

- 当前 live API service `enabled = false` 且无 listener。
- “空号池”这条原因已不再成立：用户补入 1 个成员后，`single` 隔离合同已经通过，`fallback_probe` 也已推进到显式上游门槛。
- 若目标是验证“额度耗尽后新请求切到健康账号”，当前仍缺 `small_pool` 所需的第 2 个成员。
- 在“当前 `Codex App` 不断线、本会话持续”的约束下，自动启用 live API service 或触发系统级 wakeup / notification 都不属于只读动作。
- 缺少 OS 级 tray / notification 自动观察能力，无法只靠 browser-preview 取代。

### 3.2 `NPB-03` live performance baseline

以下样本当前仍未采集：

1. live Tauri modal 首次打开
2. runtime switch 真实交互基线
3. tray / 系统通知性能基线

原因：

- 这些指标都依赖真实 live Tauri / tray / notification 运行态。
- 当前 live runtime 未启用，且自动切换到可测状态会触碰 live 配置、端口绑定或运行态切换。

## 4. N/A / Waiver

### 4.1 `gate_na`：剩余 live API service 验收

- `reason`: 2026-06-07 当前 live API service 为 `enabled=false`、`apiServiceRuntime.available=false`、`listenerCount=0`；在“当前 `Codex App` 不断线、本会话持续”的护栏下，不应自动把 live runtime 改到可测状态。
- `reason`: 2026-06-08 新增隔离 smoke 证据表明旁路 listener 可拉起；用户补入 1 个号池成员后，`single` 隔离合同已通过，`fallback_probe` 已推进到显式 `-RunUpstreamSmoke` / `-RunCodexExecSmoke` 门槛。
- `reason`: 2026-06-08 `small_pool` 预检明确要求 `accountIds` 为 2 到 3 个，当前只有 1 个成员时还不足以验证“新请求切到健康账号”的主连续性合同。
- `reason`: 2026-06-08 单账号 `RunUpstreamSmoke` 已尝试，但当前结果是请求异常且未形成有效 audit 事件链，不适合在相同前提下盲目重试消耗真实上游。
- `alternative_verification`: browser-preview reports、app-safe isolated probe、只读 live monitor、代码入口审查。
- `evidence_link`:
  - `reports/local-hardened-api-smoke/live-ui-smoke-readonly-baseline-20260607.md`
  - `reports/local-hardened-api-live-monitor/live-monitor-20260607-231751.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-001034.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-001821.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-002746.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-002810.json`
  - `reports/local-hardened-api-smoke/smoke-20260608-003000.json`
  - 本报告
- `expires_at`: 当号池补到 `small_pool` 所需的 2 到 3 个成员，且至少有 1 条真实上游 smoke 能形成有效 audit 事件链时失效。

### 4.2 `platform_na`：tray / notification 桌面断言

- `reason`: 当前会话没有可直接对原生 tray 菜单与系统通知弹窗做截图、点击或断言的可信桌面观察工具。
- `alternative_verification`: tray / notification 代码入口审查 + live read-only baseline + 后续人工观察或专用桌面抓取工具。
- `evidence_link`:
  - `src-tauri/src/modules/tray.rs`
  - `src-tauri/src/modules/tray_layout.rs`
  - `src-tauri/src/modules/wakeup_scheduler.rs`
  - `src/utils/wakeupNotificationListener.ts`
  - `reports/local-hardened-api-smoke/live-ui-smoke-readonly-baseline-20260607.md`
  - 本报告
- `expires_at`: 当当前线程可用可靠的桌面观察/抓取能力，或用户接受在受控 live 窗口下用人工观察补证据时失效。

## 5. 下次安全执行顺序

1. 先确认一个单一 live 场景，不同时推进 tray、notification、continuity、performance。
1.5. 若目标是 continuity / fallback acceptance，先确认 API 服务号池已有至少 1 个手动成员；该前置条件在 2026-06-08 已满足。
1.6. 若目标是完整 continuity/fallback 主合同，先补到 `small_pool` 所需的 2 到 3 个成员；否则无法验证“新请求切到健康账号”。
1.7. 之后的门槛才是显式 live upstream 风险确认：`accept-local-hardened-api-continuity.ps1` 默认会带 `-RunUpstreamSmoke -RunCodexExecSmoke`，而 `fallback_probe` 也要求显式 `-RunUpstreamSmoke` 或 `-RunCodexExecSmoke` 才能继续验证真实 fallback 边界。
2. 全程并行运行只读 monitor：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/monitor-live-codex-app-cockpit-acceptance.ps1 -DurationSeconds 20 -PollIntervalSeconds 2 -RequireCliConfigUntouched -RequireAppStable -WriteReport -Quiet
```

3. 优先顺序：
   - 系统通知
   - live continuity 提示
   - tray 菜单
   - live Tauri modal / runtime switch 基线
4. 每步都要先写清：
   - 将执行的确切命令或 UI 动作
   - 可能影响的窗口、托盘、通知或端口
   - 回退方式
5. 若 live API service 仍未启用，则先停在 runtime precondition，不伪造“已完成”结果。

## 6. 结论

- 截至 2026-06-07，`NPB-06` 与 `NPB-03` 的剩余项不是文档缺失，而是受 live runtime 事实、连续性护栏和桌面观察能力共同限制。
- 截至 2026-06-08，新增证据进一步表明：隔离 listener 路径已经可用，且单账号号池合同已通过；`fallback_probe` 也已推进到显式上游门槛。
- 但当前 continuity / fallback 主合同仍不能继续自动完成，因为 `small_pool` 还缺第 2 个成员，而单账号 live upstream smoke 当前也没有形成可用的 audit 证据链。
- 当前最诚实的项目状态是：低风险 / browser-preview / app-safe 证据已收口，高风险 live 验收仍未完成，但阻塞原因和下一次安全入口已经明确。
