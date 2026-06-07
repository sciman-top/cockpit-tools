# Recent Audit UI Contract - 2026-06-07

状态：pass
时间：2026-06-07 Asia/Shanghai
目标：确认 API service UI 只展示聚合健康状态与最近脱敏事件，不默认展开账号级健康细节。

## 1. 前提

- 仓库：`D:\CODE\external\Cockpit-Tools-Local`
- 相关实现：
  - `src-tauri/src/modules/codex_local_access.rs`
  - `src-tauri/src/models/codex_local_access.rs`
  - `src/components/CodexLocalAccessModal.tsx`
  - `src/pages/CodexAccountsPage.tsx`
- 相关验证：
  - `npm run build`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - `cargo test --manifest-path src-tauri/Cargo.toml recent_health_audit --quiet`
  - `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`

## 2. 审查结论

### 2.1 后端输出合同

- `CodexLocalAccessHealthSummary` 新增 `recentAuditEvents`，只暴露：
  - `timestamp`
  - `requestId`
  - `phase`
  - `status`
  - `errorType`
  - `streamState`
  - `outcome`
  - `modelKey`
  - `selectedReason`
  - `recoverAction`
  - `retryAfterMs`
  - `message`
- 不输出账号 ID、邮箱、token、完整 key、prompt、response、raw upstream body。
- focused tests `parse_recent_health_audit_event_extracts_redacted_chain_fields` 与 `load_recent_health_audit_events_prefers_latest_api_events_without_sensitive_fields` 已证明 recent event 摘要仍保持脱敏边界。

### 2.2 Modal 默认视图

- `CodexLocalAccessModal` 健康面板默认只展示：
  - 聚合计数：`healthy/cooling/exhausted/auth/manual/modelCooldown`
  - 聚合 explainability：`selectorInsight` / `blockedInsight`
  - 最近脱敏事件列表：`recentAuditEvents`
- 默认视图没有展开 `health.accounts` 的账号级细节区域。
- 账号级健康信息仍只用于：
  - 账号池成员筛选
  - 阻断成员不可选
  - 成员行状态徽标
  - 手动恢复/暂停动作

### 2.3 首页 inline card 默认视图

- API 服务首页 inline card 默认只显示：
  - 聚合健康统计
  - `selectorInsight`
  - `blockedInsight`
  - 最近 2 条脱敏 `recentAuditEvents`
- 不直接展开账号级 health entry 列表。

## 3. 默认不展开账号级细节的证据

- 聚合/最近事件入口：
  - `src/components/CodexLocalAccessModal.tsx`
  - `src/pages/CodexAccountsPage.tsx`
- 账号级 health entry 仍仅作为内部映射与成员列表辅助：
  - `accountHealthById`
  - `resolveHealthIssueMeta`
  - member picker / pool member row state
- browser preview stub 已补 recent audit 事件样例，便于后续只读 UI smoke 复用：
  - `src/utils/installBrowserPreviewTauriStub.ts`

## 4. Gate / N/A

- `gate_na`
  - `reason`: 本轮未新增 live/browser 实时 smoke；项目规则要求未获确认不自动拉起新的实时预览服务。
  - `alternative_verification`: 使用 focused tests、full build、Rust lib tests、preflight，以及现有 UI 代码路径审查完成本轮合同确认。
  - `evidence_link`:
    - `src-tauri/src/modules/codex_local_access.rs`
    - `src/components/CodexLocalAccessModal.tsx`
    - `src/pages/CodexAccountsPage.tsx`
    - 本报告
  - `expires_at`: 用户明确允许启动新的 preview/dev server 或要求补 live UI smoke 时失效。

## 5. 结论

- `HLA-04A` 中“UI 只展示聚合状态和最近脱敏事件，默认不展开账号级细节”这一条可以收口为已完成。
- `NPB-07` 的 recent audit 解释链已从“主要靠审计文件和口头说明”前进到“modal + inline card 直出最近脱敏事件摘要”。
