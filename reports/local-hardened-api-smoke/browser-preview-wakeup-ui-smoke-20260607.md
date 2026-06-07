# Browser Preview Wakeup UI Smoke - 2026-06-07

状态：pass
时间：2026-06-07 Asia/Shanghai
目标：用 browser preview + AI/browser 操控替代 Codex wakeup/reset UI 的低风险人工检查

## 1. 前提

- 仓库：`D:\CODE\external\Cockpit-Tools-Local`
- 构建命令：`npm run build`
- 预览命令：`npm run preview -- --host 127.0.0.1 --port 4173`
- 预览桩：`src/utils/installBrowserPreviewTauriStub.ts`
- 注入键：
  - `agtools.codex.accounts.cache`
  - `agtools.codex.accounts.current`
  - `agtools.codex.wakeup.overview.preview`

## 2. 注入场景

- 账号：`preview.user@example.com`
- 任务 1：`Browser Preview Quota Reset`
  - `schedule.kind = quota_reset`
  - `quotaResetWindow = either`
  - `enabled = false`
  - `executionMode = confirm`
- 任务 2：`Browser Preview Startup Wakeup`
  - `schedule.kind = startup`
  - `startupDelayMinutes = 10`
  - `enabled = false`
  - `executionMode = confirm`
- 模型预设：`GPT-5.3 Codex / gpt-5.3-codex / medium`

## 3. 浏览器审查步骤

1. 打开 `http://127.0.0.1:4173/`。
2. 注入 preview 账号与 wakeup overview。
3. 导航到 `Codex -> Wakeup Tasks`。
4. 检查任务卡：
   - 页面包含 `Paused`。
   - 页面包含 `After startup +10min`。
   - 页面包含 `Run after quota reset`。
   - 页面包含 `primary_window` / `secondary_window` reset window 解释。
5. 打开 `Add task`。
6. 检查账号选择器：
   - 账号显示为 `pr***r@e***e.com`。
   - 账号按钮 `title` 不包含完整邮箱。
7. 切换到 `After quota reset`：
   - 页面包含 `When quota-reset wakeup is enabled, auto refresh will be adjusted to run every 2 minutes.`。
   - 页面包含 `Reset window trigger condition`。
   - 页面包含 `primary_window usually maps to the 5-hour quota`。
   - 页面包含 `Quota-reset triggers depend on fresh quota data`。
8. 切换到 `After startup`，再选择 `Wake up after delay`：
   - 页面包含 `After startup +1min` 预览。
   - 页面不包含完整邮箱。

## 4. 关键发现与修复

首次 browser smoke 发现 wakeup 任务卡会显示完整 `preview.user@example.com`。
修复后，`CodexWakeupContent` 中的 wakeup 账号展示默认强制脱敏，不再依赖全局隐私模式开关。

复测结果：

- `document.body.innerText.includes("preview.user@example.com") = false`
- `[title]` 中包含完整邮箱的节点数量：`0`
- 任务卡、创建弹窗账号选择器、quota reset 提示、startup 延迟预览均可通过 browser-preview 检查。

## 5. 替代边界

这条 smoke 可以替代以下低风险人工检查：

- Codex wakeup/reset 默认 UI 是否展示风险和低频提示
- quota reset reset-window 文案是否可见
- startup wakeup 延迟预览是否可见
- wakeup 区域是否默认泄露完整邮箱或通过 `title` 泄露完整邮箱

这条 smoke 不能替代以下高风险 live 验证：

- 真实 Tauri tray 菜单与系统通知
- live Codex App / Cockpit 连续性
- 真实 upstream quota fallback 与 release exe 发布验收
