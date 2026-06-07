# Local Hardened API Browser Preview Modal Baseline - 20260607

状态：pass
时间：2026-06-07 Asia/Shanghai
类型：app-safe browser-preview interaction baseline

## 1. 范围

- 目标路径：`Codex API 服务`首页卡片 -> `CodexLocalAccessModal`
- 观测指标：modal 首次打开到标题 `API Service` 可见
- 运行环境：
  - `npm run preview -- --host 127.0.0.1 --port 4173`
  - `src/utils/installBrowserPreviewTauriStub.ts`
  - in-app browser / Playwright 只读交互
- 数据注入：browser-preview 本地接入预览数据，不触碰 live Cockpit / Codex runtime
- 样本数：5

## 2. 方法

1. 打开本地 preview 页面并进入 `Codex` 账号页。
2. 使用 browser-preview 预置的 `Codex API 服务`卡片。
3. 连续 5 次执行：
   - 点击 `.codex-local-access-card`
   - 等待 modal 标题 `API Service` 可见
   - 记录点击到可见的耗时
   - 关闭 modal，进入下一轮

## 3. 结果

| Metric | Samples | p50 | p95 | min | max | Threshold |
| --- | --- | --- | --- | --- | --- | --- |
| modal_open_visible_ms | `46, 48, 44, 37, 43` | `44ms` | `48ms` | `37ms` | `48ms` | `M` 档目标 `<= 1000ms` |

## 4. 结论

- browser-preview / app-safe 路径下，`Codex API 服务`卡片打开本地接入 modal 的首开可见时间明显低于 `M` 档阈值。
- 这份证据可以补足 `U10 / NPB-03` 在“默认前端交互路径”上的一条 app-safe 基线，不再只有 isolated synthetic 数据。
- 它仍不能替代以下高风险或更接近真实桌面运行态的基线：
  - live Tauri modal 首次打开
  - runtime switch
  - tray / 系统通知
  - live continuity 相关交互

## 5. 证据边界

- 这是 browser-preview 基线，不是 live Cockpit 桌面基线。
- 这份报告适合作为“前端默认路径无明显卡顿”的 app-safe 证据，不能单独宣称已经完成全部 `U10` 性能验收。
