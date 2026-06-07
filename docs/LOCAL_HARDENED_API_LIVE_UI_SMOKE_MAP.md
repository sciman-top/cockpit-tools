# Local Hardened API Live UI Smoke Map

状态：active
更新时间：2026-06-07

## 1. 作用

本文件专门收口 `NPB-06`：哪些 UI 验收已经可由 browser-preview 覆盖，哪些只能走 app-safe isolated probe，哪些必须在真实 live Tauri / tray / 系统通知场景下执行并需要用户确认。

它不是新的产品合同，而是高风险 UI smoke 的执行地图与分层入口。产品合同、release 读表和运行语义仍以 `docs/HARDENED_API_MASTER_PLAN.md`、`docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md`、`docs/LOCAL_HARDENED_API.md` 为准。

## 2. 三层验证分工

### 2.1 Browser Preview

适用：不需要真实启动 Tauri、tray、live Codex App 的默认 UI 路径。

当前已覆盖：

- `reports/local-hardened-api-smoke/browser-preview-ui-smoke-20260607.md`
  - API service 默认文案、DOM 脱敏、selector / blocked explainability
- `reports/local-hardened-api-smoke/browser-preview-wakeup-ui-smoke-20260607.md`
  - wakeup/reset 默认 UI、quota reset 低频提示、startup 延迟预览、邮箱脱敏
- `reports/local-hardened-api-smoke/browser-preview-recent-audit-explainability-20260607.md`
  - recent audit explainability 汇总证据

不能替代：

- 真实 tray 菜单
- 系统通知展示
- live continuity 提示
- release exe / live Tauri window 行为

### 2.2 App-safe Isolated Probe

适用：需要脚本启动临时配置或临时 gateway，但不能碰当前 live Cockpit/Codex 运行态。

当前入口：

- `scripts/accept-local-hardened-api-continuity.ps1`
- `scripts/smoke-local-hardened-api.ps1 -AppSafeIsolatedProbe`
- `scripts/monitor-live-codex-app-cockpit-acceptance.ps1` 的只读监测口径

可验证：

- 临时配置是否恢复
- CLI/App 进程是否稳定
- provider/auth hash 是否未被污染
- continuity 相关 audit / summary 是否成立

不能替代：

- 用户真实看到的 tray 菜单内容
- 系统通知弹出时机与文案
- 真实窗口焦点/单实例唤醒交互

### 2.3 Live Acceptance

适用：真实 Tauri / tray / 系统通知 / live continuity 提示。

进入条件：

1. 用户明确允许当前回合触碰相关 live 场景。
2. 已说明会观察或影响的对象：窗口、托盘、通知、App 进程、单实例唤醒、当前会话连续性。
3. 已说明回滚或退出方式。

这层验证不应在未确认前自动执行。

## 3. 当前未完成项

`NPB-06` 仍未完成的高风险 UI smoke，主要集中在：

1. tray 菜单
2. 系统通知
3. live continuity 提示
4. 更接近真实桌面运行态的 modal / runtime switch 交互

这些项目目前都没有被 browser-preview 证据真正替代。

## 4. 建议执行顺序

### 4.1 先做的

- 继续补 browser-preview / app-safe 可覆盖的前端证据。
- 用只读脚本验证 live continuity 相关 audit、hash、进程稳定性。
- 把入口脚本、风险边界、N/A 口径持续同步到 release 读表。

### 4.2 后做的

- 真实 tray 菜单 smoke
- 系统通知 smoke
- 需要观察单实例唤醒或窗口焦点变化的交互

原因：这些都更容易碰到当前 live Cockpit / Codex 连续性护栏。

## 5. 入口对照表

| 场景 | 首选入口 | 风险层级 | 是否默认可自动执行 |
| --- | --- | --- | --- |
| 默认 API service UI explainability | browser-preview reports | 低 | 是 |
| wakeup/reset 默认 UI | browser-preview wakeup smoke | 低 | 是 |
| recent audit explainability | browser-preview recent-audit report | 低 | 是 |
| continuity / quota fallback 结构证据 | app-safe isolated acceptance / monitor scripts | 中 | 是，前提是不碰 live provider 配置 |
| tray 菜单 | live Tauri smoke | 高 | 否 |
| 系统通知 | live Tauri smoke | 高 | 否 |
| live continuity 提示 | live monitor + live UI smoke | 高 | 否 |

## 6. 与 release 读表的关系

本文件不是 release 收口总表，而是 `NPB-06` 的执行地图。

- release blocker / U1-U10 / 平台口径：看 `docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md`
- 具体 smoke 分层和入口：看本文件
- 真实 live 场景是否允许执行：以当前任务中的用户确认为准
