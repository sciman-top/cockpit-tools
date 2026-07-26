# Reference Basis Matrix

更新日期：2026-06-14

本文件把 Cockpit Tools Local 的参考治理从“有参考文档”升级为“改动命中哪些 surface 时，必须查哪些本地 reference shelf 源”的机器可追踪入口。

关联真值文件：

- Policy: [reference-basis-policy.json](/D:/CODE/external/Cockpit-Tools-Local/docs/architecture/reference-basis-policy.json)
- Catalog: [reference-basis-catalog.json](/D:/CODE/external/Cockpit-Tools-Local/docs/research/reference-basis-catalog.json)
- Unified source shelf: [reference-sources.md](/D:/CODE/external/Cockpit-Tools-Local/docs/reference-sources.md)

## 执行规则

当改动命中 policy 里的 guarded surface 时，必须：

1. 先查对应的本地 reference ids，而不是只看仓内旧文档。
2. 在同一批改动里新增或更新 `reports/reference-basis/*.md` 证据。
3. 证据中必须显式包含以下字段：
   - `reference_basis_review`
   - `changed_surface_paths`
   - `reference_basis_surface_ids`
   - `required_local_reference_ids_reviewed`
   - `reference_adoption_decision`
4. `scripts/verify-reference-basis.py` 和 `scripts/release/preflight.cjs` 会把这件事当成 contract gate，而不是建议。

## Surface Matrix

| Surface ID | 触发范围 | 必查 references | 目的 |
| --- | --- | --- | --- |
| `codex-protocol-and-continuity` | Codex Responses、stream terminal、turn-state、session continuity、continuity 审查报告与测试 | `openai-codex`, `openai-openapi`, `CLIProxyAPI` | 保证 Codex-facing 行为仍以官方协议和本地 sidecar 语义为锚点 |
| `local-hardened-api-routing-and-risk` | 号池调度、cooldown、refresh-risk、backpressure、routing、acceptance/smoke guard | `openai-codex`, `CLIProxyAPI`, `sub2api`, `new-api`, `litellm` | 保证本地网关策略来自已命名参考，不靠记忆或旧结论漂移 |
| `session-visibility-and-workspace-filtering` | 会话可见性、workspace-root filtering、host continuity | `openai-codex`, `cockpit-tools-upstream` | 保证宿主连续性和 upstream fork 差异可解释 |
| `tauri-capability-and-desktop-boundaries` | Tauri capability、updater、single-instance、deep-link、桌面 runtime | `tauri`, `tao`, `wry`, `plugins-workspace` | 保证桌面宿主边界仍对齐官方实现 |
| `reference-and-release-gate-boundaries` | reference policy/catalog/matrix、snapshot 刷新、preflight、CI workflow | `openai-codex`, `cockpit-tools-upstream` | 保证 reference 治理和 release gate 自己不会脱离基线 |

## 证据模板

建议新证据文件落在 `reports/reference-basis/YYYYMMDD-<topic>.md`，最小结构如下：

```md
reference_basis_review: yes
changed_surface_paths:
- path/a
- path/b
reference_basis_surface_ids:
- surface-id
required_local_reference_ids_reviewed:
- openai-codex
- CLIProxyAPI
reference_adoption_decision:
- 采纳：
- 不采纳：
- 与本仓运行事实冲突：
```

## 当前最小闭环

- 参考源统一入口：[reference-sources.md](/D:/CODE/external/Cockpit-Tools-Local/docs/reference-sources.md)
- 快照刷新脚本：[update-reference-snapshots.ps1](/D:/CODE/external/Cockpit-Tools-Local/scripts/update-reference-snapshots.ps1)
- 验证脚本：[verify-reference-basis.py](/D:/CODE/external/Cockpit-Tools-Local/scripts/verify-reference-basis.py)
- 正式门禁入口：[preflight.cjs](/D:/CODE/external/Cockpit-Tools-Local/scripts/release/preflight.cjs)

## 备注

- 这套机制先只约束“命中 guarded surface 的改动必须留下命名 reference 证据”，不要求每次都刷新整个 external shelf。
- external shelf 的 SHA/branch 真值继续以 [reference-sources.md](/D:/CODE/external/Cockpit-Tools-Local/docs/reference-sources.md) 和 `scripts/update-reference-snapshots.ps1` 为准。
- 后续如要升级到 CI 强制检查 stale mirror/TTL，可在此基础上追加，不替代现有 build/test/preflight 主链。
