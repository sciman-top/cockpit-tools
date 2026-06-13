# Cockpit Tools Local

[English](README.en.md) · [Portuguese (BR)](README.pt-br.md) · 简体中文

[![GitHub release](https://img.shields.io/github/v/release/sciman-top/cockpit-tools-local?style=flat)](https://github.com/sciman-top/cockpit-tools-local/releases)

## 先看这里

本仓库是 [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools) 的个人自用版 fork，不是官方原版发布仓库。GitHub 首页、Release、版本号、安装资产和运行守卫都按 `Cockpit Tools Local` 自用版语义维护。

| 领域 | Cockpit Tools Local 自用版 | 官方原版 |
| --- | --- | --- |
| 仓库与产品身份 | `sciman-top/cockpit-tools-local`、产品名 `Cockpit Tools Local`、Tauri identifier `com.sciman.cockpit-tools-local` | `jlcodes99/cockpit-tools` 官方项目身份 |
| 版本与发布 | 使用 `official-base + -local.N` 语义；Release 只发布自用版构建产物，不镜像官方安装资产 | 使用官方版本号与官方发布资产 |
| 上游吸收方式 | `main` 保持自用主线，官方源码只作为 `upstream/main` 输入；通过本地隔离分支/worktree 审查后再合并 | 官方项目自身开发主线 |
| Codex 本地增强 | 保留本地 API Service、hardened gateway、账号池/跟随当前账号、provider 投影、session 可见性、quota/cooldown 和连续性守卫 | 以官方默认实现为准 |
| 安全与运行边界 | live upstream probe、drain、dev app/server、release exe 替换等都需要显式确认；不自动打断当前 Codex/Cockpit 会话 | 不适用本机自用运行守卫 |

## 当前项目状态

当前仓库时间点：`2026-06-13`

- 当前自用发布号是 `0.24.12-local.1`，`package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 已同步到同一版本。
- 当前发布姿态是 `Windows-first` 自用桌面控制面 + 默认只监听 `127.0.0.1` 的本地 Hardened API Runtime。
- 低风险证据已经收口到可复用状态：browser-preview UI smoke、recent-audit explainability、隔离 loopback listener、单账号隔离上游 smoke，以及 `~/.codex` / `Codex App` 连续性守卫都有现成报告可查。
- 真实边界仍然存在：截至 `2026-06-09`，单账号隔离上游 chat 已能通过，但小池 continuity/fallback 主合同仍未闭合。即使做了有界 drain，也还没有观察到 `usage_limit_reached -> model_cooldown_applied -> fallback_blocked` 这条链，因此“同任务 hard-affinity 闭合”和“后续新请求避开 exhausted/cooldown 账号”仍是 `blocked`，不能写成已完成。
- tray / notification / live continuity 提示这类高风险桌面验收也还没有闭合，仍需要显式 live acceptance，而不能被 preview 或只读探针冒充。

相关证据入口：

- [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
- [live-acceptance-blockers-20260607.md](reports/local-hardened-api-smoke/live-acceptance-blockers-20260607.md)
- [smoke-20260609-002356.json](reports/local-hardened-api-smoke/smoke-20260609-002356.json)
- [smoke-20260609-012423.json](reports/local-hardened-api-smoke/smoke-20260609-012423.json)

## 主要能力

Cockpit Tools Local 目前支持 12 个平台目标：

- Antigravity IDE
- Codex
- GitHub Copilot
- Windsurf
- Kiro
- Cursor
- Gemini Cli
- CodeBuddy
- CodeBuddy CN
- Qoder
- Trae
- Zed

核心能力包括：

- 多账号导入、切换、分组、批量管理和额度监控
- 多实例运行与独立用户数据目录管理
- Codex Direct OAuth / API Key / Local API Service 往返切换
- provider 投影、session 可见性修复、账号池健康状态与 cooldown registry
- hardened local API mode、脱敏 stream/audit 证据链和低风控默认策略
- Windows-first 本机入口、自用版 release 流程、以及对官方 CLIProxyAPI sidecar 配置模型的兼容吸收

补充说明：

- Gemini Cli 暂不支持多实例管理。
- OpenCode 当前是配套联动项，不在上述 12 平台统计内。
- UI 当前支持 18 种语言：English、简体中文、繁體中文、日本語、Deutsch、Español、Français、Italiano、한국어、Português、Русский、Türkçe、Polski、Čeština、العربية、Tiếng Việt、Bahasa Indonesia，以及 `en-US` 兼容 locale。

## 文档入口

如果你是第一次接手这个仓库，建议按下面顺序阅读：

1. [README.md](README.md)
2. [docs/SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md)
3. [docs/UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)
4. [docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
5. [docs/LOCAL_HARDENED_API.md](docs/LOCAL_HARDENED_API.md)
6. [docs/COCKPIT_LOCAL_TARGET_ARCHITECTURE.md](docs/COCKPIT_LOCAL_TARGET_ARCHITECTURE.md)
7. [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md)

按场景找入口：

- Codex 本地 API / Hardened API： [LOCAL_HARDENED_API.md](docs/LOCAL_HARDENED_API.md)
- 当前 release 验收口径： [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
- 剩余 blocker / truth boundary： [LOCAL_HARDENED_API_NEXT_PHASE_BACKLOG.md](docs/LOCAL_HARDENED_API_NEXT_PHASE_BACKLOG.md)
- 上游吸收与自用差异： [SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md)、[UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)
- 参考源码与本地 reference shelf： [reference-sources.md](docs/reference-sources.md)
- Ubuntu / WSL2 本地构建： [build-wsl2-ubuntu24.md](docs/build-wsl2-ubuntu24.md)

## 快速开始

### 前置要求

- Node.js 18+
- npm 9+
- Rust stable

### 安装依赖

```bash
npm install
```

### 启动开发版

```bash
npm run typecheck
npm run tauri:dev
```

`npm run tauri:dev` 会启动独立的 `Cockpit Tools Dev` 配置，不会覆盖默认自用版配置目录。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | TypeScript 快速反馈 |
| `npm run build` | 前端构建，含版本同步与类型检查 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Rust lib tests |
| `npm run release:preflight` | 完整 release preflight |
| `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test` | 仅跑 contract/invariant 类检查 |
| `npm run tauri:dev` | 启动开发版桌面应用 |
| `npm run tauri -- build` | 调用包装脚本执行 Tauri 打包 |
| `npm run preview -- --host 127.0.0.1 --port 4173` | 仅预览前端，用于 browser-preview smoke |

本仓默认门禁顺序是：

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
3. `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`
4. hotspot review：`SECURITY.md`、`src-tauri/capabilities/`、release scripts、quota/cooldown/pool routing、i18n、live continuity

## 安装

### 手动下载

前往本仓 [Cockpit Tools Local Releases](https://github.com/sciman-top/cockpit-tools-local/releases) 下载自用版安装包。这里的 Release 只代表 `Cockpit Tools Local` 自用构建；若当前版本尚未发布安装资产，请按上面的开发/构建流程自行构建，不要把官方原版 Release 当作本仓自用版。

- macOS：`.dmg`
- Windows：`.msi` 或 `.exe`
- Linux：默认不把官方 Linux 包当作自用版发布资产；需要时建议本地自编译

### Homebrew（macOS）

```bash
brew tap sciman-top/cockpit-tools-local https://github.com/sciman-top/cockpit-tools-local
brew install --cask cockpit-tools
```

如果本仓尚未发布对应 cask 更新，请优先使用手动下载或本地构建，不要用官方 upstream tap 代替 `Cockpit Tools Local`。

## 安全与隐私

- 这是本地桌面工具，账号数据主要保存在本机。
- WebSocket 默认只绑定 `127.0.0.1`，默认端口 `19528`。
- Codex hardened 默认姿态只覆盖 loopback；LAN 监听只能是高级显式 opt-in，不是默认推荐入口。
- OAuth 登录、Token 刷新、额度查询、版本检查等场景会访问官方接口。
- 不要直接分享完整用户目录；备份前请先脱敏 token / auth 文件。

常见本地数据目录：

- `~/.antigravity_cockpit`
- `~/.codex`
- `~/.gemini`
- 系统本地应用数据目录下的 `com.antigravity.cockpit-tools*`

## 开发与验证注意事项

- 日常低风险验证可以直接执行 `npm run typecheck`、`npm run build`、Cargo tests 和 focused checks。
- 涉及启动、重启或重跑 live app/server 的命令，例如 `npm run dev`、`npm run tauri:dev`、`npm run tauri -- build`，以及会真实消耗上游额度的 smoke/drain，都应先说明影响范围，再决定是否执行。
- 未经明确确认，不要自动停止、重启、kill、拉起 `Codex App`、`codex`、Cockpit release exe 或当前 live dev app/server。
- 处理 Codex API service、routing、quota continuity、pool scheduling 或 failover 相关问题前，优先看 [reference-sources.md](docs/reference-sources.md) 和本机 reference shelf，而不是只凭当前仓库文本猜测。

## 社区

- Telegram 群：[点击加入](https://t.me/+Y8gMv4SlZUU2MWY1)

## 赞助

如果这个项目对你有帮助，可以在这里支持：[☕ 赞赏支持](docs/DONATE.md)

## 致谢

- Antigravity IDE 账号切换逻辑参考：[Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager)
- Codex API service sidecar 集成参考：[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## 许可证

本项目默认采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)。

- 允许：个人学习、研究、非商业场景下的使用与修改
- 不允许：任何未获授权的商业使用
- 商业授权：请联系作者获取单独书面授权

## 免责声明

本项目仅供个人学习和研究使用。使用本项目即表示你同意：

- 未获得作者书面商业授权前，不将本项目用于任何商业用途
- 承担使用本项目的全部风险和责任
- 遵守相关服务条款和法律法规
