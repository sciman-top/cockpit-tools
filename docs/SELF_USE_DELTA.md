# Cockpit Tools Local 自用差异清单

状态：Accepted
日期：2026-05-31
适用范围：`sciman-top/cockpit-tools-local` 自用主线

## 1. 归宿

`main` 是 Cockpit Tools Local 的自用源码主线。官方原版只作为 `upstream/main` 输入源存在，`upstream` remote 指向 `https://github.com/jlcodes99/cockpit-tools.git`。

从本策略起，不再把 `mirror/upstream-main` 当作长期协作入口；需要查看官方最新版时，先 `git fetch upstream --prune`，再以 `upstream/main`、官方 tag 和 release notes 为准。

## 2. 自用版必须保留的差异

以下能力是合并上游时的保留基线，除非官方新版实现明显更优且用户明确确认，否则不得被上游覆盖掉。

| 领域 | 自用版差异 | 合并守卫 |
| --- | --- | --- |
| 仓库身份 | `sciman-top/cockpit-tools-local`，产品名 `Cockpit Tools Local`，Tauri identifier `com.sciman.cockpit-tools-local` | 不回退为官方仓库名、官方 productName 或官方 identifier |
| 发布语义 | Release 只发布自用版构建产物，不镜像官方安装资产 | Release notes 必须说明 self-use build；安装资产和 `latest.json` 指向 self-use release |
| 版本语义 | app 版本使用官方基线加本地后缀，例如 `0.24.9-local.1` | 不直接发布裸官方版本号，避免和官方原版混淆 |
| Codex 本地能力 | Cockpit API Service、Local API Service 单账号/小池、跟随当前账号、provider 写入、session 可见性修复、托管实例状态 | 上游改动不得破坏本地 API service 连续性和账号池安全边界 |
| 配额与冷却 | quota continuity、cooldown registry、stream/audit 证据、低刷新默认值 | 不通过重复刷新或扩大真实上游消耗来判断冷却恢复 |
| 风险控制 | live upstream probe、drain、dev app/server、release exe 替换都需要显式确认 | 不自动停止、重启、kill、替换 Codex App、Cockpit release exe 或 live dev app |
| 项目规则与本机辅助文件 | `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、本机运维说明等按本仓事实维护 | 上游同步不得删除或覆盖本仓规则与本机运维边界说明 |
| 本机入口 | Windows-first 本机路径、desktop shortcut、self-build release path | 不把官方安装路径或 Store/官方 release 当作自用版运行事实 |

## 3. 可吸收的官方改动

官方新版的以下改动通常应优先吸收，但仍要审查对自用差异的影响：

- 新平台支持、账号导入、配额解析、OAuth 修复。
- UI 可用性改进、多语言文案、无障碍和快捷键改进。
- Tauri/Rust/Node 依赖安全更新。
- 官方客户端路径、存储格式、provider schema 的兼容性修复。
- release workflow 中与 self-use release 不冲突的构建修复。

## 4. 冲突裁决

默认裁决：保留自用版行为。

如果官方新版实现更好，合并者必须先给出对比：

| 字段 | 内容 |
| --- | --- |
| 冲突点 | 文件、函数、配置或用户可见行为 |
| 自用版行为 | 当前保留的本地逻辑 |
| 官方新版行为 | 官方新增或修改的逻辑 |
| AI 推荐 | 推荐保留自用版、采用官方版，或手动融合 |
| 理由 | 正确性、安全性、兼容性、维护成本和可验证证据 |
| 验证 | 必跑命令、live/smoke 条件、回滚方式 |

用户确认前，不把重叠区域直接替换成官方实现。

## 5. 版本记录

每次吸收官方新版后，至少记录：

- `upstream_base_version`：已吸收的官方 tag，例如 `v0.24.9`。
- `upstream_base_sha`：合并时的 `upstream/main` SHA。
- `local_app_version`：自用版发布号，例如 `0.24.9-local.1`。
- `sync_branch`：本地隔离合并分支，例如 `codex/upstream-sync-v0.24.9-20260531`。
- `evidence`：构建、测试、contract/invariant、hotspot review 和必要 live/screenshot 证据。

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 应使用同一个 `local_app_version`。更新官方基线但尚未完成合并和门禁时，不提前 bump 版本。
