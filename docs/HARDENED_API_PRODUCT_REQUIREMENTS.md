# Hardened API Product Requirements

状态：active
更新时间：2026-06-06

## 1. 产品定位

本文件定义 Cockpit Tools Local 自用版中「Codex Hardened Local API」的产品级合同。它回答三件事：

1. 这个能力到底为谁服务。
2. 它必须解决什么问题。
3. 什么才算真正交付成功。

本文件优先于局部路线图、专项计划和运行手册；如果实现文档与本文件冲突，应先修正文档合同，再继续实现。

## 2. 目标用户

### 主要用户

- 同时维护多个 Codex / ChatGPT OAuth 账号的重度自用用户。
- 需要在不中断当前工作流的前提下，安全管理本地账号池、配额、provider 切换和小规模 fallback 的用户。
- 明确接受「低并发、低刷新、强解释性」而不是「高吞吐、最大化扫号」的用户。

### 次要用户

- 需要在 Cockpit Tools Local 中排查本地 API service、账号健康、cooldown 和连续性问题的维护者。

## 3. 核心问题

当前产品要解决的不是“如何把更多请求打出去”，而是以下问题：

- Codex 任务在本地 API service 介入后，如何尽量保持会话连续性和任务完整性。
- 当账号遇到 `429`、quota exhausted、auth error、manual required 等状态时，如何避免误切号、乱切号、扫完整池或破坏当前任务。
- 当用户需要切换 Direct OAuth / Direct API / Local API Service 时，如何不打断当前 live Cockpit/Codex 运行连续性。
- 当系统做出调度或拒绝决定时，用户是否能看懂“为什么是这个账号”“为什么没切号”“为什么现在不可用”。

## 4. 产品目标

### G1. 连续性优先

- 已经被上游接纳并开始写出的同一任务流，不应因为本地健康状态变化被 retroactively cancel。
- 带 `previous_response_id` 或 `x-codex-turn-state` 的硬亲和请求，不得静默跨账号续接。

### G2. 风险控制优先

- 默认路径必须是低并发、低刷新、低探测、无随机轮换。
- 不做公网网关、不做商业中转、不做 anti-detection、不做全池高频探测恢复。

### G3. 可解释性优先

- 每次账号选择、跳过、冷却、拒绝和本地闭合都必须有用户可读的解释和机器可审计的证据。

### G4. 保持 Cockpit 为控制面

- Cockpit Tools Local 仍是账号真源、provider 真源和运行时策略控制面。
- 社区网关项目只提供结构启发，不替代本产品的控制权和语义边界。

## 5. 非目标

- 不把 Cockpit Tools Local 变成公网或多租户 API gateway。
- 不追求把 500+ free 账号做成高频吞吐池。
- 不以“让每个请求都尽量换新账号”为产品目标。
- 不以“隐藏平台真实限制”或“伪装请求来源”作为产品能力。

## 6. 一级用户场景

### U1. 单账号稳定执行

用户启用 Local API Service 后，用单账号完成一次真实 Codex 任务，过程中不出现 LAN 误导、不暴露敏感信息、不因为本地策略导致中断。

### U2. 小池安全切换

用户配置 2-3 个账号作为小池；新的独立请求在遇到 quota exhausted / cooldown 账号时，应避开坏账号选择健康账号，但不把同一 turn 静默切给新账号。

### U3. 人工可恢复

当所有账号都不可调度时，系统必须给出明确原因摘要和下一步恢复动作，而不是只返回模糊 transport error。

### U4. Direct / Local 往返切换

用户在 Direct OAuth / Direct API / Local API Service 之间切换时，Cockpit 应保持会话可见性、provider 投影和当前运行实例连续性。

### U5. 自用版安全发布

用户升级、同步上游或启用 updater 时，不应扩大 capability 暴露面，也不应破坏自用版身份与回滚路径。

## 7. 功能性要求

### F1. 账号池与调度

- 账号池成员由用户显式管理。
- 默认调度策略是 `sticky_process + fill_first + capped fallback`。
- “fallback” 必须拆分理解：
  - `hard affinity`：`previous_response_id` / `x-codex-turn-state`，禁止跨账号。
  - `same-request rescue`：仅限未向下游写出前、且只针对 failover-safe 情况的有限补救。
  - `next-request reselection`：当前请求结束后，新独立请求可以重新选择健康账号。

### F2. 健康状态机

- 至少支持：`healthy`、`cooling_down`、`quota_exhausted`、`auth_suspect`、`manual_required`、`manual_paused`。
- 状态必须持久化，并能跨进程/重启恢复。

### F3. 连续性边界

- 一旦向客户端写出响应头或首个 payload，当前请求禁止切号续接。
- `Codex-facing /v1/responses` 的 `pool_unavailable` 行为必须是显式合同，不能是 transport 层意外副产物。

### F4. 可观测性

- UI 必须展示账号池健康摘要、blocked reason、最近恢复建议。
- audit trail 必须串起：listener、selector、classifier、health update、stream/final boundary。

### F5. 敏感信息保护

- 不在日志、DOM title、UI tooltip、审计文件中暴露完整 key、token、Authorization、完整邮箱、prompt、response。

## 8. 运行与安全要求

### S1. 本地边界

- 默认只监听 `127.0.0.1`。
- 不把兼容字段 `lan_base_url` 当成产品推荐入口。

### S2. Tauri capability 边界

- capability 必须保持最小暴露面。
- 新增 updater、shell、process、fs 等权限时，必须显式复核 capability 合并后的权限窗口。

### S3. Updater 边界

- updater 必须被视为高影响面能力。
- 更新检查、下载、安装权限和签名链不得在文档或实现上含糊带过。

## 9. 成功指标

这些是产品级 release acceptance 指标，而不是商业 KPI：

1. Codex-facing 新 admission 全池不可用时，不出现默认 transport `503/pool_unavailable`、`response.failed`、heartbeat-only open wait 或静默断线。
2. 同任务硬亲和请求不会跨账号静默续接。
3. 新独立请求能避开 cooldown / exhausted / manual required 账号。
4. 默认配置下不触发 request-level random routing、高频 live probe 或全池扫射。
5. UI 和日志不暴露完整密钥、token、完整邮箱。
6. 用户能在 UI 或报告中看懂“为什么不可用”和“下一步恢复动作”。

## 10. 当前需要澄清的问题

以下问题仍需要明确决策；未澄清前，不应把相关行为扩展为更宽的默认能力：

1. `fallbackMode` 是否保留当前字段名，还是在未来拆成更清晰的三段式配置。
2. `Codex-facing local completed Responses` 是长期正式合同，还是阶段性兼容合同。
3. Windows-first 是否继续作为一级体验目标；macOS/Linux 是否只保持兼容。
4. “性能成功”到底以什么阈值衡量：启动时间、轮询时间、切换时间，还是大账号池排序延迟。

## 11. 文档地图

- 总控入口：[HARDENED_API_MASTER_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/HARDENED_API_MASTER_PLAN.md)
- 总体方向：[LOCAL_HARDENED_API_ROADMAP.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_ROADMAP.md)
- 实施任务：[LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md)
- 调度专项：[LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md)
- 刷新专项：[ACCOUNT_RISK_CONTROL_REFRESH_HARDENING_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/ACCOUNT_RISK_CONTROL_REFRESH_HARDENING_PLAN.md)
- 性能专项：[LOCAL_HARDENED_API_PERFORMANCE_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_PERFORMANCE_PLAN.md)
- Codex 协议附录：[LOCAL_HARDENED_API_CODEX_RESPONSES_PROTOCOL.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_CODEX_RESPONSES_PROTOCOL.md)
- 用户旅程验收矩阵：[LOCAL_HARDENED_API_ACCEPTANCE_MATRIX.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_ACCEPTANCE_MATRIX.md)
- 运行手册：[LOCAL_HARDENED_API.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API.md)
- 参考源码：[reference-sources.md](/D:/CODE/external/Cockpit-Tools-Local/docs/reference-sources.md)
