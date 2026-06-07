# Live UI Smoke Read-only Baseline - 2026-06-07

状态：pass
时间：2026-06-07 Asia/Shanghai
目标：在不启动/停止/重启 live Cockpit / Codex 进程、不切换 provider、不触发真实 tray/通知交互的前提下，先补一份只读级 live UI 现场基线。

## 1. 观测范围

- 当前 live 进程集合
- 当前 `codex_local_access.json` / runtime mode 事实
- 当前 live monitor 只读结果
- tray 配置与更新代码入口
- 系统通知与 wakeup 通知代码入口

## 2. 当前现场事实

### 2.1 进程

观测时间内存在：

- `Cockpit Tools` 主进程 1 个
- 多个 `Codex` / `codex` 相关进程

说明：当前桌面运行态活跃，继续做真实 tray/系统通知 smoke 时有连续性风险，不能把高风险动作伪装成低风险检查。

### 2.2 本地接入运行态

只读读取 `C:\Users\sciman\.antigravity_cockpit\codex_local_access.json`：

- `enabled = false`
- `port = 45335`
- `accessScope = lan`
- `accountIds = []`

只读 monitor 同时显示：

- runtime mode = `direct_projection`
- listener count = `0`
- API service runtime = `unavailable`

结论：当前 live API service 并未处于监听运行态，因此本轮无法把 `tray` / `系统通知` / `live continuity` 的真实 UI 交互验收伪装成“已经完成”。

## 3. 只读 continuity 证据

执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/monitor-live-codex-app-cockpit-acceptance.ps1 -DurationSeconds 20 -PollIntervalSeconds 2 -RequireCliConfigUntouched -RequireAppStable -WriteReport -Quiet
```

关键结果：

- `overall = pass`
- `codexCliGuard.comparison.unchanged = true`
- `codexAppGuard.comparison.stable = true`
- `apiServiceRuntime.available = false`
- `reportPath = reports/local-hardened-api-live-monitor/live-monitor-20260607-231751.json`

说明：这条证据证明“当前 live 进程与 CLI 配置未被我动到”，同时也证明“本轮没有可用的 live API service listener 可供继续做真实 API service UI smoke”。

## 4. tray / notification 代码入口

### 4.1 tray

- `src-tauri/src/modules/tray.rs`
  - `create_tray_skeleton`
  - `build_tray_menu`
  - `update_tray_menu`
  - `handle_tray_event`
- `src-tauri/src/modules/tray_layout.rs`
  - `load_tray_layout`
  - `save_tray_layout`

结论：tray 菜单内容与平台可见性配置的代码入口是明确的，但本轮未做真实托盘弹出与点击交互。

### 4.2 notification

- `src-tauri/src/modules/wakeup_scheduler.rs`
  - `send_confirmation_notification`
- `src/utils/wakeupNotificationListener.ts`
  - `notification://action`
  - `wakeup://notification-mapping`
- `src-tauri/src/modules/account.rs`
  - quota alert native notification

结论：系统通知发送与前端监听链路代码入口明确，但本轮未主动触发真实通知，也未观察操作系统层弹出行为。

## 5. 本轮能确认什么

- live Cockpit / Codex 进程当前稳定，CLI 配置未被改动。
- `NPB-06` 的入口、代码链路和现场只读事实已经补齐。
- 真实 tray / 系统通知 / live continuity 提示 smoke 仍未完成，且当前 live API service 未启用。

## 6. 本轮不能宣称完成什么

- 不能宣称已经完成 tray 菜单交互验收。
- 不能宣称已经完成系统通知弹出与动作回调验收。
- 不能宣称已经完成 live continuity 提示的真实桌面交互验收。
- 不能宣称已经完成 live Tauri modal / runtime switch 性能基线。

## 7. 下一步建议

若继续自动推进剩余高风险项，合理顺序应是：

1. 在用户已授权的前提下，选择一个明确的 live 场景：
   - 启用 API service
   - 或进入 wakeup/notification 触发场景
2. 同时运行只读 monitor，保留 `CLI config untouched` 与 `App stable` 证据。
3. 再做真实 tray / 系统通知 / continuity 提示取证。

在当前 `enabled = false`、listener 不存在的运行事实下，不应伪造这些结果。
