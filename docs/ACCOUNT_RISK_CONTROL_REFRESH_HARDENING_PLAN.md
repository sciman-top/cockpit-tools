# 账号风控刷新降噪专项计划

更新时间：2026-06-06

## 目标与边界

本专项承接 `docs/LOCAL_HARDENED_API_ROADMAP.md`、`docs/LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md`、`docs/LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md` 和 `docs/reference-gateway-best-practices.md`。当前落点是各平台账号刷新、配额刷新、托盘快捷刷新、Codex quota 批量刷新和当前账号自动刷新 UI；目标归宿是低并发、低刷新、尊重 cooldown、可解释、可手动恢复的账号风控降噪系统。

本专项不做绕过平台限制、验证码/风控规避、UA/IP/指纹伪装、跨账号扫射或高频额度探测。风控风险降低只通过保守调度、减少无意义刷新、减少并发尖峰、持久化 cooldown 证据和用户可见状态实现。

## 证据分层

- 本仓代码事实、focused tests、smoke/preflight report 是最终裁决源。
- 官方 `openai-codex` 源码用于 Codex-facing turn、stream、quota/status 和 `previous_response_id` 语义；当前本地参考源为 `D:\CODE\external\_reference_gateway_sources\openai-codex`，2026-06-06 已刷新到 `87b808bb5`。
- OpenAI 官方错误码与 rate limit 文档用于解释 429/503、`Retry-After`、backoff 和“失败重试仍消耗 per-minute limit”。
- Sub2API、CLIProxyAPI、LiteLLM、New API 只借鉴可本地化的 `IsSchedulable()`、persistent cooldown、fill-first、pre-call limiter、首字节后不重试和 channel disable 结构。
- 社区文章、issue 和最佳实践只作为待核线索，不覆盖官方源码、本仓实测或本专项合同。
- 统一参考清单、当前本地 revision 和刷新命令见 `docs/reference-sources.md`。

## 当前问题判断

1. `web_report` 的自动认证刷新使用全局 stale 阈值，容易让某个平台状态过期触发所有启用平台刷新，和按平台间隔控制的预期不一致。
2. 托盘 `tray:refresh_quota` 当前并发触发多个平台刷新，容易形成本地尖峰；它应该是低频、顺序、可失败隔离的用户便利动作。
3. Codex quota 批量刷新默认使用强制 live refresh，不适合作为风控友好的默认批量路径；默认应优先本地观测、reset/cooldown 和最小必要上游刷新。
4. 当前账号自动刷新 UI 仍展示低于真实下限的分钟预设，容易诱导用户以 1/2/5/10/15 分钟理解刷新策略，而代码实际会按更高下限归一化。

## 实施原则

1. 先降刷新频率和并发，再扩展账号池利用率。
2. 默认路径不发起 live upstream quota probe；真实上游探测必须显式授权。
3. 任何批量刷新都要有最大并发、最小间隔、失败隔离和可取消/可观察边界。
4. UI 预设必须和后端/工具函数真实下限一致，避免“看似低频、实际被归一化”的误导。
5. cooldown recovery 默认从已存 reset time/health registry 推断，不通过重复 polling 恢复。
6. 每个任务都保持小步可回滚，优先改已有函数和 UI 文案，不新增常驻守护进程。

## 路线图

### Phase 0 - 计划与参考快照

目标：让后续风控降噪改动有明确任务入口和最新参考 SHA。

任务：

- [x] 新增本专项计划文档。
- [x] 刷新本地官方 `openai-codex` 参考源到 `4417e4c19`。
- [x] 更新 `docs/reference-gateway-best-practices.md` 的 OpenAI Codex 快照。
- [x] 2026-06-06 再次刷新本地官方 `openai-codex` 参考源到 `87b808bb5`，并同步 `docs/reference-gateway-best-practices.md` / `docs/reference-sources.md`。
- [x] 在每个代码任务完成后把状态回写到本文件。

验证：

- [x] `git -C D:\CODE\external\_reference_gateway_sources\openai-codex status --short --branch`
- [x] `git -C D:\CODE\external\_reference_gateway_sources\openai-codex rev-parse --short=8 HEAD`

### Phase 1 - 刷新入口降尖峰

目标：消除最容易放大账号风控风险的并发刷新和全局 stale 刷新。

#### ARH-01 web_report 按平台刷新判定

描述：把 `maybe_trigger_auth_refresh_check()` 从全局 stale 触发改为按平台 `interval_minutes`、最近更新时间和 enabled 状态判定；没有到期的平台不刷新。

验收：

- [x] 全局 report stale 不会让所有启用平台同时刷新。
- [x] `interval_minutes <= 0` 或 disabled 平台不刷新。
- [x] 到期平台仍能刷新，并记录平台级结果。

验证：

- [x] 针对 `web_report` 刷新判定补 focused Rust test 或等价纯函数测试。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib web_report`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib`

#### ARH-02 托盘配额刷新顺序化

描述：把 `tray:refresh_quota` 的平台刷新从 `Promise.all` 改为顺序执行或小并发执行，默认并发 1；每个平台失败只记录自身错误，不中断后续平台。

验收：

- [x] 托盘刷新不会同时打所有平台刷新命令。
- [x] 单个平台失败不会阻断其他平台。
- [x] 用户仍能从日志看到失败平台和成功完成。

验证：

- [x] `npm run typecheck`
- [x] hotspot 复核 `src/App.tsx` 托盘监听路径。

### Phase 2 - Codex quota 默认安全路径

目标：让 Codex quota 批量刷新默认尊重本地观测、cooldown 和 reset，而不是每次强制 live refresh。

#### ARH-03 Codex 批量刷新默认非强制

描述：新增或调整 Codex 批量刷新路径，使普通批量刷新默认 `force_live_refresh = false`；需要强制 live refresh 的入口必须显式命名、显式 UI 文案或脚本参数。

验收：

- [x] 普通 Codex 批量刷新优先复用本地 quota observations 和 health registry。
- [x] cooldown/reset 未到的账号不会因为批量刷新被反复探测。
- [x] 强制 live refresh 入口仍可用于人工确认场景，但不会成为默认路径。

验证：

- [x] hotspot 复核 `refresh_current_codex_quota` / `refresh_all_quotas` 默认使用 `RefreshQuotaOptions::default()`。
- [x] focused Rust test 覆盖 force/non-force 分支。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- [x] `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`

### Phase 3 - UI 预设与认知降噪

目标：让用户看到的自动刷新预设和真实最小间隔一致，减少误操作。

#### ARH-04 当前账号刷新预设对齐真实下限

描述：把 Settings 与 Quick Settings 中低于真实最小值的当前账号刷新预设移除或替换为 `30/60/120/...` 等保守预设，并确保自定义输入会显示归一化提示。

验收：

- [x] UI 不再展示低于真实最小间隔的预设。
- [x] 自定义值低于最小间隔时，用户能看到被调整到最小值。
- [x] `currentAccountRefresh` 的常量、校验和 UI 选项一致。

验证：

- [x] `npm run typecheck`
- [x] hotspot 复核 `src/utils/currentAccountRefresh.ts`、Settings、Quick Settings。

### Phase 4 - 证据与发布门禁

目标：把风控降噪改动纳入已有门禁，避免后续回归。

任务：

- [x] 为托盘刷新和当前账号刷新增加低成本静态/单元验证。
- [x] 在 release preflight 或 focused script 中加入 refresh-risk guard。
- [x] 更新本文件任务状态和必要的报告路径。

验证顺序：

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
3. `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`
4. hotspot review：`SECURITY.md`、`src-tauri/capabilities/`、local hardened API risk guards、quota/cooldown/pool routing、i18n 文案、live session continuity。

2026-06-03 首批验证记录：

- [x] `node scripts/test-refresh-risk-guard.cjs`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib refresh_quota_options_`
- [x] `npm run typecheck`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib web_report`
- [x] `npm run build`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- [x] `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`

说明：本轮未执行 live upstream quota probe、未启动/重启 Cockpit 或 Codex；验证限定在本地 build/test/contract/hotspot 证据内。

## 任务清单总览

- [x] ARH-00：计划与参考快照。
- [x] ARH-01：`web_report` 按平台刷新判定。
- [x] ARH-02：托盘配额刷新顺序化。
- [x] ARH-03：Codex 批量刷新默认非强制。
- [x] ARH-04：当前账号刷新预设对齐真实下限。
- [x] ARH-05：刷新风险 focused guard。

## 回滚入口

- 文档变更：Git 回滚本文件、`docs/reference-gateway-best-practices.md`、`docs/LOCAL_HARDENED_API_ROADMAP.md`、`docs/LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md`。
- 前端刷新入口：回滚 `src/App.tsx`、Settings、Quick Settings 和 `src/utils/currentAccountRefresh.ts` 相关 diff。
- Rust 刷新入口：回滚 `src-tauri/src/modules/web_report.rs`、`src-tauri/src/modules/codex_quota.rs`、`src-tauri/src/commands/codex.rs` 相关 diff。
- 本地参考源：`D:\CODE\external\_reference_gateway_sources\openai-codex` 仅作为只读参考；若需要复现旧审查，使用历史 SHA，不回滚主仓代码。
