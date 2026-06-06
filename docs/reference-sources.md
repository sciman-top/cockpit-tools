# Reference Sources

更新时间：2026-06-06

## 目标

本文件统一记录 Cockpit Tools Local 当前可直接查阅的本地参考源码、它们在本项目中的定位，以及后续刷新入口。

原则保持与现有项目文档一致：

- Codex-facing 行为以官方 `openai-codex` 源码和本仓实测为最高语义锚点。
- `sub2api`、`new-api`、`CLIProxyAPI`、`litellm` 主要作为调度、cooldown、限流、observability 和网关结构参考。
- `cockpit-tools-upstream`、`tauri`、`plugins-workspace` 主要作为上游产品和框架实现参考，不直接替代本仓设计。

## 本地路径约定

项目当前统一使用以下目录保存外部参考源码：

`D:\CODE\external\_reference_gateway_sources`

该目录已经补齐。后续项目文档、源码审查和手工对照，优先引用这里的镜像路径。

## 当前参考清单

| Project | Local path | Branch | Current revision | 用途 |
| --- | --- | --- | --- | --- |
| OpenAI Codex | `D:\CODE\external\_reference_gateway_sources\openai-codex` | `main` | `87b808bb5` | 官方 Codex CLI 源码；`/v1/responses`、stream terminal、turn metadata、`previous_response_id`、provider/model/config 行为 |
| CLIProxyAPI | `D:\CODE\external\_reference_gateway_sources\CLIProxyAPI` | `main` | `fca12a263` | CLI/OAuth 代理、本地 API sidecar、fill-first、session affinity、首字节后不重试边界 |
| Sub2API | `D:\CODE\external\_reference_gateway_sources\sub2api` | `main` | `635ad81cd` | 账号健康状态机、persistent cooldown、sticky 会话、临时不可调度 |
| New API | `D:\CODE\external\_reference_gateway_sources\new-api` | `main` | `adc390c5f` | 渠道网关、渠道禁用、重试、限流、统一入口和 backpressure 结构 |
| LiteLLM | `D:\CODE\external\_reference_gateway_sources\litellm` | `litellm_internal_staging` | `22186f457` | 通用 router、pre-call rate checks、cooldown matrix、proxy observability |
| Cockpit Tools Upstream | `D:\CODE\external\_reference_gateway_sources\cockpit-tools-upstream` | `main` | `28cae0d22` | 官方原版 Cockpit Tools 只读镜像，便于与当前本地 fork 做纯净对照 |
| Tauri | `D:\CODE\external\_reference_gateway_sources\tauri` | `dev` | `66f873d62` | Tauri 2 核心源码，适合核对 capability、window lifecycle、updater 和 runtime 语义 |
| Official Tauri Plugins | `D:\CODE\external\_reference_gateway_sources\plugins-workspace` | `v2` | `4350ca652` | 官方插件实现，适合对照 `dialog/fs/opener/process/updater/single-instance/deep-link/autostart` |

## 项目内入口

以下文档已经把这些参考源纳入决策链或设计论证：

- [reference-gateway-best-practices.md](/D:/CODE/external/Cockpit-Tools-Local/docs/reference-gateway-best-practices.md)
- [LOCAL_HARDENED_API_ROADMAP.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_ROADMAP.md)
- [LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_IMPLEMENTATION_PLAN.md)
- [LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md)
- [ACCOUNT_RISK_CONTROL_REFRESH_HARDENING_PLAN.md](/D:/CODE/external/Cockpit-Tools-Local/docs/ACCOUNT_RISK_CONTROL_REFRESH_HARDENING_PLAN.md)
- [UPSTREAM_SYNC_POLICY.md](/D:/CODE/external/Cockpit-Tools-Local/docs/UPSTREAM_SYNC_POLICY.md)

## 重要说明

### 1. 官方优先级

如果官方 `openai-codex`、官方 Tauri 源码与社区网关项目出现冲突：

1. 先看本仓运行事实和 focused tests。
2. 再看官方 `openai-codex` / Tauri 源码。
3. 最后才参考 `sub2api`、`new-api`、`CLIProxyAPI`、`litellm` 的结构做法。

### 2. 重复源码的处理

- 本仓已有 `git remote upstream` 指向 `jlcodes99/cockpit-tools`；`cockpit-tools-upstream` 仍保留为只读源码镜像，便于不污染当前工作区地翻上游实现。
- 本仓已有 vendored sidecar 路径 `sidecars/cockpit-cliproxy/cdk/CLIProxyAPI`；该目录更适合作为随仓版本的一部分。若要看 CLIProxyAPI 最新 upstream 实现，优先使用 `D:\CODE\external\_reference_gateway_sources\CLIProxyAPI`。
- `D:\CODE\external\ai-coding-runtime-references\repos\openai-codex` 已存在另一份 `openai-codex`。对 Cockpit Tools Local 而言，后续统一以 `D:\CODE\external\_reference_gateway_sources\openai-codex` 为项目约定入口，避免文档和脚本继续分叉。

### 3. 适合直接借鉴的层面

- `openai-codex`：Codex 本体语义、配置写回、provider/model 行为。
- `CLIProxyAPI`：本地 API sidecar、流式边界、凭据选择。
- `sub2api`：账号池调度、健康状态、cooldown。
- `new-api`：网关限流、禁用策略、重试框架。
- `litellm`：pre-call limiter、router cooldown、proxy observability。
- `tauri` / `plugins-workspace`：桌面宿主能力、插件实现、updater/runtime 细节。

## 刷新方式

统一刷新命令：

```powershell
$root = 'D:\CODE\external\_reference_gateway_sources'

git -C "$root\openai-codex" pull --ff-only origin main
git -C "$root\CLIProxyAPI" pull --ff-only origin main
git -C "$root\sub2api" pull --ff-only origin main
git -C "$root\new-api" pull --ff-only origin main
git -C "$root\litellm" pull --ff-only origin litellm_internal_staging
git -C "$root\cockpit-tools-upstream" pull --ff-only origin main
git -C "$root\tauri" pull --ff-only origin dev
git -C "$root\plugins-workspace" pull --ff-only origin v2
```

刷新后建议同步更新：

- 本文件里的 `Current revision`
- [reference-gateway-best-practices.md](/D:/CODE/external/Cockpit-Tools-Local/docs/reference-gateway-best-practices.md) 的 Source Snapshot
- 相关计划文档里引用的 SHA 或本地路径说明
