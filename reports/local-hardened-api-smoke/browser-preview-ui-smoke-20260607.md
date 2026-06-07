# Browser Preview UI Smoke - 2026-06-07

状态：pass
时间：2026-06-07 Asia/Shanghai
目标：用 browser preview + AI 审查替代本地接入 UI 的手工 DOM/log/title 检查

## 1. 前提

- 仓库：`D:\CODE\external\Cockpit-Tools-Local`
- 构建命令：`npm run build`
- 预览命令：`npm run preview -- --host 127.0.0.1 --port 4173`
- 预览桩：`src/utils/installBrowserPreviewTauriStub.ts`
- 注入键：
  - `agtools.codex.accounts.cache`
  - `agtools.codex.accounts.current`
  - `agtools.codex.local_access.state.preview`

## 2. 审查范围

1. `Codex API 服务`页面：
   - 服务密钥 `<code>` 节点不再通过 `title` 暴露完整 key。
   - `客户端 Key` 页签中的 client key `<code>` 节点不再通过 `title` 暴露完整 key。
   - 页面默认语言、监听姿态与文案保持 `仅本机 / 127.0.0.1`，不再把 hardened 默认描述为 LAN。
2. `CodexLocalAccessModal`：
   - 健康面板能展示 `最近调度`、`当前阻断`、`恢复动作`、`建议等待`。
   - selector / blocked explainability 采用脱敏聚合文案，不泄露完整 key。
3. `Codex API 服务`首页 inline card：
   - 不打开 modal 也能直接看到 `最近调度`、`当前阻断`、`恢复动作`、`建议等待`。
   - selector explainability 继续显示聚合候选、可调度、`尝试上限` 和 skip reason，而不是只剩最终结果。

## 3. 注入场景

- API service running：`true`
- Access scope：`localhost`
- Client host：`127.0.0.1`
- Service key：`ck-preview••••••••••••`
- Client key：`sk-preview••••••••••••`
- `selectorInsight.selectedReason = sticky_selected`
- `selectorInsight.capApplied = true`
- `selectorInsight.capLimit = 2`
- `blockedInsight.errorType = pool_unavailable`
- `blockedInsight.recoverAction = retry_after_cooldown_or_start_new_task`

## 4. 关键结果

### 4.1 API service 页面

- 页面正文包含：
  - `Codex API 服务`
  - `运行中`
  - `仅本机`
  - `127.0.0.1`
  - `ck-preview••••••••••••`
- DOM 检查结果：
  - 服务 key `<code>`：`title = null`
  - client key `<code>`：`title = null`
  - 未发现 `title` 中包含 `preview-secret` 或完整 client key 片段的节点

### 4.2 本地接入 modal

- 页面正文包含：
  - `最近调度`
  - `沿用 sticky 账号`
  - `当前阻断`
  - `恢复动作`
  - `建议等待`
  - `API 服务号池暂无可调度账号（冷却中 1 个）`
- 审查结论：
  - explainability UI 已可在 browser preview 中直接检查
  - 健康状态、selector、blocked reason 都是脱敏聚合文案
  - 本次注入场景下未发现完整服务 key / client key 通过 DOM title 泄露

### 4.3 API 服务首页 inline card

- 页面正文包含：
  - `最近调度`
  - `当前阻断`
  - `尝试上限 2`
  - `恢复动作: 等待冷却结束后重试，或开启新的独立任务`
  - `建议等待: 120s`
- DOM / 文本检查结果：
  - `.codex-local-access-inline-insights` 已直接呈现 selector / blocked explainability，不必先打开 modal
  - inline card 文案包含 `候选 4`、`可调度 1`、`因健康状态跳过 2`、`因尝试上限截断 1`
  - 未发现 `title` 属性包含 `pool_unavailable` 或额外解释性泄露

## 5. 替代边界

这条 smoke 可以替代以下手工检查：

- DOM `title` 是否泄露完整 API key
- hardened 默认文案是否误导为 LAN
- health panel / selector / blocked explainability 是否在 modal 与首页 inline card 可见

这条 smoke 不能替代以下高风险 live 验证：

- live Codex App / Cockpit 连续性
- 托盘、wakeup、updater、系统级权限提示
- 真实上游 quota fallback / LAN listener 的最终发布验收
