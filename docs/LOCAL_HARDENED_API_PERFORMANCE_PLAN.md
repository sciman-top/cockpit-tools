# Local Hardened API Performance Plan

**状态**: active
**目标归宿**: 降低 Codex API service 启动/停用、Direct API/OAuth 切换、配额刷新和账户页轮询的等待与卡顿。
**当前落点**: 先做低风险、可回滚的观测与轻量刷新切片；不改变 live upstream quota probe 策略，不自动重启运行中的 Cockpit/Codex。

## Phase 1 - 当前切片

- 后端 state snapshot 增加分段耗时日志，只在超过阈值时记录，便于定位慢在 profile、stats、health、account health 还是 concurrency diagnostics。
- 新增 lightweight local access state 读取路径，给常驻轮询使用，避免每 5 秒拉取完整统计和历史事件。
- 前端 API service 轮询优先使用 lightweight state，并把结果合并进现有完整 state。
- 分组配额刷新改为 UI 侧有界并发，减少大量账户串行刷新造成的长等待，同时保留并发上限。
- Direct API/OAuth 与 API service runtime mode 设置增加同模式 no-op 检测，避免重复点击或重复刷新时重新 materialize projection。

## Phase 2 - 下一批优先项

- 将 full state 中的 audit/events/recent stats 拆成详情页或按需 endpoint，让 modal 打开和轮询不被历史数据拖慢。
- 给 health summary/account health 加短 TTL 或 revision cache，避免启动、刷新、切换时重复读取同一批 registry 文件。
- 对 Direct API/OAuth 切换做更细的 projection diff：目标 provider/profile 未变化但账号元数据变化时，只写必要字段，避免重复刷新整条链路。
- 为启动/停用 API service 增加 phase telemetry：runtime load、gateway ensure、port binding、member projection、health restore、UI render 分开计时。
- 账户列表在大账户池下引入 deferred filter/排序缓存；必要时再评估虚拟列表，避免无证据地扩大改造。

## 验收口径

- 快速反馈：`npm run typecheck`。
- 项目门禁顺序：`npm run build` -> `cargo test --manifest-path src-tauri/Cargo.toml --lib` -> `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test` -> hotspot review。
- 若 Go sidecar 构建阻断 Rust lib test，可使用 `COCKPIT_SKIP_CLIPROXY_BUILD=1` 记录替代验证；阻断原因必须单独回收，不把它当成本切片性能回归。
