# 官方上游吸收策略

状态：Accepted
日期：2026-05-31
适用范围：从 `jlcodes99/cockpit-tools` 吸收更新到 Cockpit Tools Local 自用版

官方上游镜像、本地网关参考源和框架参考源的统一入口见 `docs/reference-sources.md`。其中 `D:\CODE\external\Cockpit-Tools-Local-references\cockpit-tools-upstream` 作为只读源码镜像，便于在不污染当前工作区的情况下对照官方实现。

## 1. 分支模型

| 分支或 ref | 归宿 |
| --- | --- |
| `main` | 自用版唯一长期源码主线 |
| `upstream/main` | 官方原版最新源码，只读输入源 |
| `codex/upstream-sync-v<upstream>-<date>` | 每次吸收官方新版的本地隔离 review 分支 |
| `backup/selfuse-pre-upstream-sync-<timestamp>` | 本地恢复点，只用于回滚当次同步 |

不再维护长期 `mirror/upstream-main` 分支作为协作入口。需要官方最新版时，先刷新 `upstream/main`：

```powershell
git fetch upstream --prune
git log --oneline --decorate --max-count=20 upstream/main
git tag --list "v*" --sort=-v:refname | Select-Object -First 10
```

## 2. 固定流程

1. 先确认自用主线状态：

```powershell
git status --short --branch
git remote -v
git branch -vv --all
```

2. 读取自用差异和官方更新：

```powershell
Get-Content docs/SELF_USE_DELTA.md
git fetch upstream --prune --tags
git log --oneline main..upstream/main
git diff --name-status main..upstream/main
```

3. 创建本地隔离 worktree 和 review 分支：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File D:\CODE\github-toolkit\scripts\Update-CockpitSelfUseFork.ps1 -PlanOnly
pwsh -NoProfile -ExecutionPolicy Bypass -File D:\CODE\github-toolkit\scripts\Update-CockpitSelfUseFork.ps1
```

4. 在 review worktree 中合并官方更新：

- 以 `main` 为基线创建 `codex/upstream-sync-v<upstream>-<date>`。
- 执行 `git merge --no-ff upstream/main`。
- 冲突默认保留自用版；官方实现明显更优时，按 `docs/SELF_USE_DELTA.md` 的冲突裁决表向用户说明并等待决定。

5. 深度审查官方新增功能：

重点审查：

- Codex API service、provider 写入、Direct OAuth/API Key、local hardened API。
- quota、cooldown、account pool、stream、retry、fallback、audit trail。
- Tauri capabilities、updater/signing、release workflow。
- 账号/凭据/本地 state schema、导入导出、跨平台路径。
- 新依赖、权限、网络请求和外部 URL。

6. 版本号只在合并完成后更新：

示例：官方基线是 `v0.24.9`，第一次自用吸收版发布为 `0.24.9-local.1`。后续仅自用修复递增为 `0.24.9-local.2`；下一次吸收官方 `v0.25.0` 后改为 `0.25.0-local.1`。

7. 门禁顺序不可跳过：

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test
```

hotspot review 必须覆盖 `SECURITY.md`、`src-tauri/capabilities/`、release scripts、local hardened API risk guards、quota/cooldown/pool routing、i18n 文案和 live session continuity。

8. GitHub 只做展示和 PR：

合并分支可推到 `origin` 作为 PR：

```powershell
git push origin codex/upstream-sync-v<upstream>-<date>
```

GitHub PR 用于查看 diff、运行远端 checks 和保留讨论记录；不使用 GitHub 在线 merge-upstream 直接改写 `main`。

## 3. 回滚

若合并阶段失败：

```powershell
git merge --abort
```

若 review 分支已经形成但不再采用：

```powershell
git worktree remove <review-worktree-path>
git branch -D codex/upstream-sync-v<upstream>-<date>
```

若已合入 `main` 但未发布，优先用 Git revert 回滚合并提交。若涉及 release exe、updater、账号/provider/live config，还必须记录备份路径、restore 命令和进程/会话连续性复测。
