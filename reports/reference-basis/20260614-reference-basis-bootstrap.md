reference_basis_review: yes

changed_surface_paths:
- .github/workflows/build-matrix.yml
- docs/architecture/reference-basis-policy.json
- docs/research/reference-basis-catalog.json
- docs/research/reference-basis-matrix.md
- docs/reference-sources.md
- README.md
- README.en.md
- README.pt-br.md
- scripts/release/preflight.cjs
- scripts/test-local-hardened-api-live-risk-guard.ps1
- scripts/verify-reference-basis.py

reference_basis_surface_ids:
- local-hardened-api-routing-and-risk
- reference-and-release-gate-boundaries

required_local_reference_ids_reviewed:
- CLIProxyAPI
- litellm
- new-api
- openai-codex
- sub2api
- cockpit-tools-upstream

reference_adoption_decision:
- 采纳：沿用已在 `D:\CODE\governed-ai-coding-runtime` 验证过的 `policy + catalog + matrix + verifier + preflight` 结构，避免在本仓另起一套 reference governance 形状。
- 采纳：继续以 `docs/reference-sources.md` 作为 local shelf 路径与 SHA 入口，不再新增第二份手工维护的 mirror 清单。
- 采纳：`scripts/test-local-hardened-api-live-risk-guard.ps1` 进入 guarded surface，后续此类风险守卫改动必须显式回看 `CLIProxyAPI`、`sub2api`、`new-api`、`litellm` 与 `openai-codex` 的本地镜像。
- 不采纳：暂不在本次切片里把 stale mirror TTL/branch drift 升级为阻断 gate；先把 guarded surface 与 evidence contract 落稳，再决定是否补时效告警。
- 与本仓运行事实冲突：无。当前改动没有触碰 live runtime state，也没有改变 Codex/Cockpit 连续性或上游 probe 策略。
