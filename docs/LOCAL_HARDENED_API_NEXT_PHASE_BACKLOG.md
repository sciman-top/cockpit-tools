# Local Hardened API Next Phase Backlog

状态：active
更新时间：2026-06-07

## 1. 作用

本文件收口那些“已经识别出价值，但不应阻塞当前蓝图收敛”的后续事项。它不替代 PRD、路线图和实施计划，而是把下一阶段仍需澄清、细化和补证据的问题集中起来，避免再次散落到讨论记录里。

产品合同见 `docs/HARDENED_API_PRODUCT_REQUIREMENTS.md`，总控入口见 `docs/HARDENED_API_MASTER_PLAN.md`，最佳终态蓝图见 `docs/COCKPIT_LOCAL_TARGET_ARCHITECTURE.md`。

## 2. 当前已达成共识

- 最现实的最佳终态是“Windows-first 本地桌面控制面 + 本地 Hardened API Runtime”，不是公网 SaaS，也不是多租户网关。
- Hardened 默认边界仍是 `127.0.0.1` loopback。
- 如果未来支持 LAN 监听，它也只能作为高级显式 opt-in，而不是 hardened 默认推荐路径，更不是公网开放入口。
- Codex-facing 行为以本仓运行事实、官方 `openai-codex` 源码和 `openai-openapi` 规范为最高语义锚点；社区项目只提供调度、cooldown、backpressure 和 observability 结构参考。

## 3. 下一阶段待收敛事项

| ID | 主题 | 当前问题 | 期望产出 |
| --- | --- | --- | --- |
| NPB-01 | `fallbackMode` 语义彻底收敛 | 产品、路线图、实现、UI 容易把 `fallbackMode`、same-request rescue、next-request reselection 混为一谈 | 2026-06-07 已补统一术语、配置命名草案、release summary 对照表与策略预设提示；剩余仅在未来真正拆字段时做兼容迁移 |
| NPB-02 | 高级显式 LAN 模式合同 | 已确认“可以有，但不能是默认”，仍缺正式 release 级边界 | 2026-06-07 已补独立合同与总控入口同步；剩余只在未来真实启用/发布 LAN 时补 live acceptance 证据 |
| NPB-03 | 性能基线报告 | 已补首份 isolated synthetic `M/L` 基线与 browser-preview modal 首开 app-safe 样本；2026-06-07 已补剩余 live blocker 报告，明确当前 `enabled=false` / listener 缺失下不能自动补采更接近真实桌面运行态的交互样本 | `reports/` 下的启动、轮询、切换、刷新、大号池排序基线与复测报告 |
| NPB-04 | Release acceptance summary | `docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md` 已补齐总表，并新增关键证据映射；剩余工作是随新报告持续同步 U10/高风险 live evidence | 继续把 release 读表保持成“当前证据总入口”，而不是一次性文档 |
| NPB-05 | Windows-first / cross-platform 发布语义 | release summary 已明确 Windows 一级体验、macOS/Linux 兼容级口径；剩余工作只在未来非 Windows 也要承担同权 release 时展开 | 若未来要发布 macOS/Linux 一级体验，再补独立 acceptance 与打包语义 |
| NPB-06 | UI smoke 自动化 | preview/default 与 wakeup/reset UI 已由 browser-preview 覆盖；2026-06-07 已补 live UI smoke 分层地图、只读现场基线与剩余 live blocker 报告 | 剩余仍是高风险 live Tauri/tray/系统通知/continuity 提示自动化，需要在合适的 live 运行场景下继续取证 |
| NPB-07 | 推荐排序与解释性 | modal 与首页 inline card 已能直出 selector / blocked / recover 摘要，并新增 recent audit 脱敏事件列表；2026-06-07 已补 browser-preview explainability 汇总证据 | 剩余主要是把这条解释链继续扩到高风险 live UI smoke，而不是再拆散成更多零碎合同 |

## 4. 高级 LAN 模式草案边界

以下是当前建议，不代表已经进入默认实现：

1. 默认发布姿态保持 `127.0.0.1`，LAN 不是默认入口。
2. 只能通过高级显式开关启用，且需要明确风险提示。
3. 不支持把 LAN 模式包装成“hardened 推荐路径”。
4. 不支持公网开放，不支持把 `0.0.0.0` 作为默认值。
5. 需要一键回退到 loopback，并留下审计与回滚证据。
6. 需要单独通过 hotspot review：capability、凭据、日志、updater、live continuity。
7. `lan_base_url` 继续只作为兼容字段，不能提前当作产品推荐入口。

## 5. 官方与社区后续怎么用

- 官方优先：继续以本仓运行事实、OpenAI 官方文档、`openai-codex`、`openai-openapi`、Tauri 官方系源码作为第一证据层。
- 社区限于结构：`CLIProxyAPI`、`sub2api`、`new-api`、`litellm` 继续只提供 selector、cooldown、retry boundary、observability 的结构启发。
- 不新增“为了看起来完整而囤积”的参考镜像。当前本地参考仓库已足够支撑主线工作。

## 6. 参考仓库策略

### 6.1 保留

继续保留当前已拉取的本地参考镜像，统一入口为 `D:\CODE\external\Cockpit-Tools-Local-references` 与 `docs/reference-sources.md`。

### 6.2 现在无需新增

当前没有“必须立刻再拉”的参考仓库。就本项目现阶段而言，官方 Codex/OpenAPI/Tauri 系，加上 `CLIProxyAPI`、`sub2api`、`new-api`、`litellm`，已经覆盖了主线决策需要的证据面。

### 6.3 按需增补

只有在出现明确缺口时才按问题驱动增补，例如：

- 官方 SDK 字段或 streaming 行为需要额外对照。
- Tauri 底层原生窗口、菜单、托盘或 WebView 行为出现源码级疑难问题。
- 本地 HTTP/SSE runtime 的底层边界需要更深一层官方或框架源码佐证。

在没有具体问题前，不建议继续扩大镜像集合。
