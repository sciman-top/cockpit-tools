# Browser Preview Recent Audit Explainability - 2026-06-07

状态：pass
时间：2026-06-07 Asia/Shanghai
目标：确认 browser-preview 下的 `Codex API 服务`首页 inline card 与 `CodexLocalAccessModal` 都能直接展示 recent audit explainability，而不必先翻审计文件。

## 1. 前提

- 仓库：`D:\CODE\external\Cockpit-Tools-Local`
- 预览命令：`npm run preview -- --host 127.0.0.1 --port 4173`
- 预览桩：`src/utils/installBrowserPreviewTauriStub.ts`
- 入口页面：`Codex` 账号页中的 `Codex API 服务`卡片
- 相关既有合同：
  - `reports/local-hardened-api-smoke/recent-audit-ui-contract-20260607.md`
  - `reports/local-hardened-api-smoke/session-affinity-observability-contract-20260607.md`

## 2. 审查范围

1. 首页 inline card：
   - `最近审计`
   - `请求来源: X-Client-Request-Id`
   - `亲和来源: Session_id`
   - `恢复动作: 等待冷却结束后重试，或开启新的独立任务`
2. `CodexLocalAccessModal`：
   - modal 已可打开
   - modal 里继续可见 `最近审计`
   - recent event 里可见 `pool_unavailable`
   - 可见 `建议等待: 3s`

## 3. browser-preview 结果

使用 in-app browser / Playwright 对页面正文做只读检查，结果如下：

| 检查项 | 结果 |
| --- | --- |
| inline recent audit 可见 | pass |
| inline `请求来源: X-Client-Request-Id` 可见 | pass |
| inline `亲和来源: Session_id` 可见 | pass |
| inline `恢复动作: 等待冷却结束后重试，或开启新的独立任务` 可见 | pass |
| modal 可打开且标题 `API Service` 可见 | pass |
| modal 中 `最近审计` 可见 | pass |
| modal 中 `pool_unavailable` 可见 | pass |
| modal 中 `建议等待: 3s` 可见 | pass |

## 4. 结论

- recent audit explainability 已从“代码/ focused tests/ 单独合同”进一步收口为“browser-preview 页面可直接复核”的发布证据。
- 首页 inline card 与 modal 现在都能把：
  - 请求来源
  - 软亲和来源
  - 恢复动作
  - 建议等待
  这条解释链直接展示出来。
- 这份报告可以作为 `NPB-07` 和 `U9` 的一条集中证据入口，减少后续还得同时翻 recent audit 合同与 session-affinity observability 合同的次数。

## 5. 边界

- 本报告仍属于 browser-preview / app-safe 证据，不替代 live Tauri / tray / 系统通知 / live continuity 的高风险 UI 验收。
- 本报告不改变 `X-Client-Request-Id` 仅作 thread-scoped observability 的语义，也不把 `Session_id` 升级成 hard-affinity。
