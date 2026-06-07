# Local Hardened API Advanced LAN Mode Contract

状态：active
更新时间：2026-06-07

## 1. 作用

本文件定义 Cockpit Local Hardened API 在“高级显式 LAN 模式”下的正式边界。它只约束 `accessScope = lan` 这一条高级 opt-in 路径，不改变 hardened 默认 loopback 姿态，也不把 LAN 升格成默认推荐入口。

产品合同见 `docs/HARDENED_API_PRODUCT_REQUIREMENTS.md`，总控语义见 `docs/HARDENED_API_MASTER_PLAN.md`，默认 loopback 运行手册见 `docs/LOCAL_HARDENED_API.md`，release 收口读表见 `docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md`。

## 2. 当前实现事实

- UI 与持久化配置当前已经暴露 `accessScope = localhost | lan`。
- `accessScope = lan` 时，监听绑定地址会从 `127.0.0.1` 扩到 `0.0.0.0`。
- `lan_base_url` 当前只作为兼容/显示字段保留，不能被文档或 release notes 包装成 hardened 默认推荐入口。
- 默认客户端投影、默认文档和默认 smoke 入口仍以 loopback 为准。

这些事实来自当前仓内实现，不代表“LAN 已成为默认产品能力”。

## 3. 开启条件

只有同时满足以下条件，才允许启用 LAN：

1. 由用户显式选择 `访问范围 = 局域网`，不能由 preset、自动迁移或隐式修复悄悄开启。
2. 使用场景明确是可信局域网/同网段协作或受控设备访问，不是公网暴露，也不是“先开着再看”。
3. 使用者知道这会把监听面扩大到 `0.0.0.0`，并愿意承担额外的网络暴露面与误配置风险。
4. 启用前已经有清楚的回退路径：可以一键切回 `localhost`，且不会连带破坏 provider/auth/runtime continuity。

以下场景明确不在范围内：

- 把 LAN 当成 hardened 默认路径。
- 以 `0.0.0.0` 作为默认值或初始安装值。
- 公网开放、端口映射、未知网段共享、无防火墙约束的“临时先用”。

## 4. 风险提示合同

任何能够开启 LAN 的 UI 或 release 说明，至少要让用户理解这几件事：

1. 这不是 hardened 默认推荐路径，而是高级显式 opt-in。
2. 启用后监听面会扩大到局域网，风险高于 `127.0.0.1` loopback。
3. 只应在可信网段使用，不支持公网开放。
4. 启用后必须保留一键回退到 loopback。
5. 开启/回退都应留下审计和可回溯证据。

推荐提示语气是“风险说明 + 回退入口 + 适用范围”，而不是泛泛写成“也可以局域网访问”。

## 5. 绑定范围与地址合同

### 5.1 允许的绑定语义

- `localhost`：绑定 `127.0.0.1`，这是 hardened 默认与发布默认。
- `lan`：绑定 `0.0.0.0`，但只应被解释为“高级显式局域网模式”。

### 5.2 不允许的语义漂移

- 不把 `lan_base_url` 当作默认客户端地址。
- 不因为存在 LAN 选项，就把所有默认示例、CLI 投影、运行手册改成 LAN 地址。
- 不把 `0.0.0.0` 写成“推荐监听地址”。

### 5.3 客户端与文档口径

- 本机默认示例仍使用 `http://127.0.0.1:<port>/v1` 或 `http://localhost:<port>/v1`。
- 如果需要远端设备接入，应在 LAN 合同、风险提示和 release acceptance 中单独说明，而不是混入默认 quickstart。

## 6. 回滚与审计

### 6.1 最小回滚动作

1. 将 `accessScope` 从 `lan` 切回 `localhost`。
2. 复核 UI/状态中监听地址恢复为 `127.0.0.1`。
3. 确认未联动修改 provider/auth/runtime mode。
4. 记录回滚时间、操作来源和回退后配置摘要。

### 6.2 必留证据

- 变更前后的 `accessScope`。
- 绑定地址从 `0.0.0.0` 回到 `127.0.0.1` 的可见证据。
- 是否涉及 live Cockpit/Codex continuity 风险。
- 若本轮无法做 live 验证，按 `gate_na` / `platform_na` 记录替代验证与过期时间。

## 7. 验收与 Hotspot Review

## 7.1 最小门禁

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test
git diff --check
```

## 7.2 LAN 模式额外复核

- UI 是否明确把 LAN 标成高级显式 opt-in，而不是默认推荐路径。
- `src-tauri/capabilities/`、日志脱敏、provider/auth projection、updater、live continuity 是否有额外暴露面。
- 默认 quickstart、运行手册、release notes 是否仍以 loopback 为主。
- 回退入口是否可见、可操作、可验证。

## 7.3 当前可接受的替代验证

在没有用户明确授权动 live runtime 的前提下，本轮可以接受：

- 文档合同对齐
- UI 风险提示对齐
- build / Rust lib tests / preflight / diff check

但这不能伪装成“已经完成 LAN live acceptance”。若未来真的把 LAN 作为可发布能力使用，还需补 app-safe/live 网络验证证据。

## 8. 非目标

以下内容不属于本合同要解决的范围：

- 多租户公网 API 网关
- 自动发现局域网客户端
- 为 LAN 单独增加认证旁路或弱化 hardened 默认安全边界
- 用 LAN 模式替代 Direct/loopback 默认工作流
