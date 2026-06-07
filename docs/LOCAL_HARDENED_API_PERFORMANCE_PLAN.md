# Local Hardened API Performance Plan

**状态**: active
**目标归宿**: 降低 Codex API service 启动/停用、Direct API/OAuth 切换、配额刷新和账户页轮询的等待与卡顿。
**当前落点**: 先做低风险、可回滚的观测与轻量刷新切片；不改变 live upstream quota probe 策略，不自动重启运行中的 Cockpit/Codex。

产品级合同见 `docs/HARDENED_API_PRODUCT_REQUIREMENTS.md`；文档总控入口见 `docs/HARDENED_API_MASTER_PLAN.md`。本计划补充了首版性能阈值、样本规模和设备口径；截至 2026-06-07，`state_light` / `state_full` / `selector_sort` 已有首份 isolated synthetic `M/L` 基线报告，`Codex API 服务`卡片 -> 本地接入 modal 首开也已有 browser-preview app-safe 基线，后续仍需用更接近 live Tauri 的真实交互基线继续校准。

## 性能原则

- 不为了“看起来快”而扩大 live upstream 探针、后台唤醒或高频刷新。
- 优先优化本地状态读取、投影、排序和 UI 渲染路径，而不是把性能问题转嫁给更多上游请求。
- 所有阈值默认先服务 Windows-first 自用主路径；macOS/Linux 当前以兼容、不回归为底线。

## 样本口径

### 参考设备

- Windows 11，本地 NVMe SSD，日常自用工作站。
- Cockpit Desktop 正常冷启动，不强制关闭其它常驻开发工具。
- 不要求 release 打包构建完成，只看运行时交互路径。

### 数据规模分档

- `S`：20 个账号以内，适合单用户日常配置。
- `M`：50 个账号以内，作为默认 release acceptance 基线。
- `L`：200 个账号以内，作为大池稳定性观察档，不要求所有指标与 `M` 完全同阈值。

### 统计口径

- 除非另有说明，默认看 `p95`。
- 每项至少执行 5 次；涉及轮询/刷新类操作至少取 10 个样本。
- 若只拿到 1-2 次人工样本，最多记为临时观察，不记为 release baseline。

## Phase 1 - 当前切片

- 后端 state snapshot 增加分段耗时日志，只在超过阈值时记录，便于定位慢在 profile、stats、health、account health 还是 concurrency diagnostics。
- 新增 lightweight local access state 读取路径，给常驻轮询使用，避免每 5 秒拉取完整统计和历史事件。
- 前端 API service 轮询优先使用 lightweight state，并把结果合并进现有完整 state。
- 分组配额刷新改为 UI 侧有界并发，减少大量账户串行刷新造成的长等待，同时保留并发上限。
- Direct API/OAuth 与 API service runtime mode 设置增加同模式 no-op 检测，避免重复点击或重复刷新时重新 materialize projection。
- 已补 `scripts/measure-local-hardened-api-performance.ps1`，通过 Rust 隔离测试生成 `reports/local-hardened-api-performance/` 首版 `M/L` synthetic baseline。

## Phase 2 - 下一批优先项

- 将 full state 中的 audit/events/recent stats 拆成详情页或按需 endpoint，让 modal 打开和轮询不被历史数据拖慢。
- 给 health summary/account health 加短 TTL 或 revision cache，避免启动、刷新、切换时重复读取同一批 registry 文件。
- 对 Direct API/OAuth 切换做更细的 projection diff：目标 provider/profile 未变化但账号元数据变化时，只写必要字段，避免重复刷新整条链路。
- 为启动/停用 API service 增加 phase telemetry：runtime load、gateway ensure、port binding、member projection、health restore、UI render 分开计时。
- 账户列表在大账户池下引入 deferred filter/排序缓存；必要时再评估虚拟列表，避免无证据地扩大改造。

## 首版阈值

| 指标 | `M` 档目标 | `L` 档观察阈值 | 说明 |
| --- | --- | --- | --- |
| API service lightweight state 轮询 | `p95 <= 150ms` | `p95 <= 300ms` | 常驻轮询主路径；超过阈值应优先看 registry / stats 读取 |
| API service full state 拉取 | `p95 <= 800ms` | `p95 <= 1500ms` | modal 打开或手动刷新时允许更慢，但不能明显卡死 UI |
| API service 启用到 ready | `p95 <= 2000ms` | `p95 <= 3500ms` | 仅统计本地运行态 ready，不含首次下载/构建 |
| API service 停用到 UI 稳定 | `p95 <= 1200ms` | `p95 <= 2000ms` | 不应长时间显示旧状态 |
| Direct API/OAuth 同模式 no-op 切换 | `p95 <= 120ms` | `p95 <= 200ms` | 同目标模式重复点击不应重新 materialize projection |
| Direct API/OAuth 模式切换完成 | `p95 <= 1200ms` | `p95 <= 2000ms` | 仅看本地配置/投影收敛，不含上游 quota probe |
| 20 账号分组刷新首个可见结果 | `p95 <= 2000ms` | `p95 <= 3500ms` | 强调“用户先看到进展” |
| 20 账号分组刷新整体收敛 | `p95 <= 12000ms` | `p95 <= 20000ms` | 受并发上限控制，不追求极限吞吐 |
| API 服务成员推荐排序 | `p95 <= 80ms` | `p95 <= 150ms` | 指单次纯排序/派生，不含远程刷新 |
| modal 首次打开可交互 | `p95 <= 1000ms` | `p95 <= 1800ms` | 可接受延迟，但不可出现明显空白等待 |

## 触发告警而非立即阻断的信号

- `L` 档超过观察阈值，但 `M` 档仍达标。
- 指标偶发超阈值，但 telemetry 能清楚定位到单一慢点且已有回滚方案。
- 只有人工 smoke 样本，没有足够重复样本。

## 直接阻断 release 的信号

- `M` 档下 lightweight state 轮询或同模式 no-op 切换明显超阈值，导致日常操作卡顿。
- 启用/停用 API service 导致 UI 长时间悬挂、状态错乱或误判运行态。
- 为追求性能而重新引入高频 live probe、批量 OAuth 刷新或扫描式排序。

## 基线采集建议

建议把以下数据写入后续报告：

- 数据规模档位：`S/M/L`
- 样本次数
- `p50/p95/max`
- 设备口径
- 是否冷启动
- 是否命中 live-risk guard
- 是否使用 ephemeral gateway / isolated probe

## 当前基线证据

- 首版 isolated synthetic 报告：
  `reports/local-hardened-api-performance/perf-baseline-20260607-202512.md`
- 复跑入口：
  `pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/measure-local-hardened-api-performance.ps1`
- 当前已覆盖：
  `state_light`、`state_full`、`selector_sort`
- 当前已补 app-safe 交互样本：
  `reports/local-hardened-api-performance/browser-preview-modal-baseline-20260607.md`
- 当前未覆盖：
  live Tauri modal 首次打开、tray / 系统通知、runtime switch 的 app-safe / live 真实交互基线

## 验收口径

- 快速反馈：`npm run typecheck`。
- 项目门禁顺序：`npm run build` -> `cargo test --manifest-path src-tauri/Cargo.toml --lib` -> `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test` -> hotspot review。
- 若 Go sidecar 构建阻断 Rust lib test，可使用 `COCKPIT_SKIP_CLIPROXY_BUILD=1` 记录替代验证；阻断原因必须单独回收，不把它当成本切片性能回归。

## 下一步高价值动作

1. 在已有 isolated synthetic baseline 与 browser-preview modal 首开基线之上，继续补齐 live Tauri modal 首次打开、mode switch、tray / 系统通知等 app-safe / live 真实交互基线。
2. 持续把阈值摘要和基线报告同步到 `docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md`，避免专项计划与 release 读表脱节。
3. 若 `L` 档排序仍有卡顿，再评估更激进的缓存或虚拟列表，而不是先扩大刷新频率。
