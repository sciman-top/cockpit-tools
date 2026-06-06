# Cockpit Tools Local

English · [Portuguese (BR)](README.pt-br.md) · [简体中文](README.md)

[![GitHub release](https://img.shields.io/github/v/release/sciman-top/cockpit-tools-local?style=flat)](https://github.com/sciman-top/cockpit-tools-local/releases)

## Start Here: This Is The Cockpit Tools Local Self-Use Edition

This repository is a personal self-use fork of [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools), not the official upstream release repository. The GitHub landing page, releases, version numbers, and installable assets are maintained under the `Cockpit Tools Local` self-use semantics.

| Area | Cockpit Tools Local | Official upstream |
| --- | --- | --- |
| Repository and product identity | `sciman-top/cockpit-tools-local`, product name `Cockpit Tools Local`, Tauri identifier `com.sciman.cockpit-tools-local` | Official `jlcodes99/cockpit-tools` identity |
| Versioning and releases | Uses local suffixes such as `0.24.10-local.1`; releases publish self-use builds only and do not mirror official install assets | Uses official version numbers and official release assets |
| Upstream absorption | `main` remains the self-use source line; official source is tracked as `upstream/main` and merged through isolated local branches/worktrees after review | Official project development line |
| Codex local enhancements | Keeps the local API Service, hardened gateway, account pool/follow-current routing, provider projection, session visibility, quota/cooldown, and continuity guards | Follows official default behavior |
| Safety and runtime boundaries | Live upstream probes, drains, dev app/server runs, and release exe replacement require explicit confirmation; current Codex/Cockpit sessions are not interrupted automatically | Host-local self-use guards are not part of upstream |
| Merge policy | Overlaps default to the Local implementation; when upstream is clearly better, the recommendation and rationale are explained before adoption | Does not maintain this local delta |

Main self-owned capabilities include Codex Direct OAuth/API Key provider roundtrip switching, Local API Service small-pool scheduling, hardened local API mode, quota/cooldown registry, redacted stream/audit evidence, account cache sanitization, Windows-first local entrypoints, self-use release flow, and compatible absorption of the official CLIProxyAPI sidecar.

See [Self-Use Delta](docs/SELF_USE_DELTA.md) for the full local delta and [Upstream Sync Policy](docs/UPSTREAM_SYNC_POLICY.md) for future upstream absorption.

A **universal AI IDE account management tool**, currently supporting **Antigravity IDE**, **Codex**, **GitHub Copilot**, **Windsurf**, **Kiro**, **Cursor**, **Gemini Cli**, **CodeBuddy**, **CodeBuddy CN**, **Qoder**, **Trae**, and **Zed**, with multi-instance parallel workflows.

> Designed to help users efficiently manage multiple AI IDE accounts, this tool supports one-click switching, quota monitoring, wake-up tasks, and multi-instance parallel runs, helping you fully utilize resources from different accounts.

**Features**: One-click Switch · Multi-account Management · Multi-instance · Quota Monitoring · Wake-up Tasks · Device Fingerprints · Plugin Integration · GitHub Copilot Management · Windsurf Management · Kiro Management · Cursor Management · Gemini Cli Management · CodeBuddy Management · CodeBuddy CN Management · Qoder Management · Trae Management · Zed Management

**Languages**: Supports 18 languages

🇺🇸 English · 🇨🇳 简体中文 · 繁體中文 · 🇯🇵 日本語 · 🇩🇪 Deutsch · 🇪🇸 Español · 🇫🇷 Français · 🇮🇹 Italiano · 🇰🇷 한국어 · 🇧🇷 Português · 🇷🇺 Русский · 🇹🇷 Türkçe · 🇵🇱 Polski · 🇨🇿 Čeština · 🇸🇦 العربية · 🇻🇳 Tiếng Việt · 🇮🇩 Bahasa Indonesia

**Officially supported platforms**: macOS, Windows, and Linux.

---

## Feature Overview

### 1. Dashboard

A brand new visual dashboard providing a one-stop status overview:

- **Twelve-Platform Support**: Simultaneously displays Antigravity IDE, Codex, GitHub Copilot, Windsurf, Kiro, Cursor, Gemini Cli, CodeBuddy, CodeBuddy CN, Qoder, Trae, and Zed account status
- **Quota Monitoring**: Real-time view of remaining quotas and reset times for each model
- **Quick Actions**: One-click refresh, one-click wake-up
- **Visual Progress**: Intuitive progress bars showing quota consumption

> ![Dashboard Overview](docs/images/dashboard_overview.png)

### 2. Antigravity IDE Account Management

- **One-Click Switch**: Switch the currently active account instantly without manual login/logout
- **Multiple Import Methods**: OAuth, Refresh Token, Plugin Sync
- **Wake-up Tasks**: Schedule AI model wake-ups to trigger quota reset cycles in advance
- **Device Fingerprints**: Generate, manage, and bind device fingerprints to reduce risk

> ![Antigravity IDE Accounts](docs/images/antigravity_list.png)
>
> *(Wakeup Tasks & Device Fingerprints)*
> ![Wakeup Tasks](docs/images/wakeup_detail.png)
> ![Device Fingerprints](docs/images/fingerprint_detail.png)

#### 2.1 Antigravity IDE Multi-Instance

Run multiple Antigravity IDE instances in parallel with different accounts. For example, open two Antigravity IDE instances, bind different accounts, and handle different projects independently.

- **Isolated Accounts**: Each instance binds a different account and runs independently
- **Parallel Projects**: Run multiple tasks/projects at the same time
- **Argument Isolation**: Custom instance directory and launch arguments

> ![Antigravity IDE Instances](docs/images/antigravity_instances.png)

### 3. Codex Account Management

- **Dedicated Support**: Optimized account management experience for Codex
- **Quota Display**: Clear display of Hourly and Weekly quota status
- **Plan Recognition**: Automatically identifies account Plan types (Basic, Plus, Team, etc.)
- **API Service & Switching Ownership**: Cockpit Tools Local natively owns Codex roundtrip switching among Direct OAuth, Direct API/API Key providers, and the Local API Service, including single-account/follow-current behavior, provider writes, session visibility repair, managed instance launch state, account sync, config projection, status, and usage statistics; the local edition keeps the hardened gateway and continuity guards first while staying compatible with the official CLIProxyAPI sidecar configuration model.

> ![Codex Accounts](docs/images/codex_list.png)

#### 3.1 Codex Multi-Instance

Codex also supports parallel multi-instance usage. For example, open two Codex instances, bind different accounts, and handle different projects independently.

- **Isolated Accounts**: Each instance binds a different account and runs independently
- **Parallel Projects**: Run multiple tasks/projects at the same time
- **Argument Isolation**: Custom instance directory and launch arguments

> ![Codex Instances](docs/images/codex_instances.png)

### 4. GitHub Copilot Account Management

- **Account Import**: OAuth, Token/JSON import
- **Quota View**: Inline Suggestions / Chat messages usage and reset time
- **Plan Recognition**: Auto-detects Free / Individual / Pro / Business / Enterprise tiers
- **Batch Operations**: Tags and bulk actions

#### 4.1 GitHub Copilot Multi-Instance

Manage VS Code Copilot instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: Each instance uses its own user data directory
- **Quick Lifecycle**: Start/stop/force stop instances
- **Window Control**: Open instance windows and close all instances

### 5. Windsurf Account Management

- **Account Import**: OAuth, Token/JSON import, and local import
- **Quota View**: Shows Plan, User Prompt credits, Add-on prompt credits, and cycle information
- **Batch Operations**: Tags and bulk actions
- **Switch Injection**: Supports injecting and launching Windsurf after account switch

#### 5.1 Windsurf Multi-Instance

Manage Windsurf instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: Each instance uses its own user data directory
- **Quick Lifecycle**: Start/stop/force stop instances
- **Window Control**: Open instance windows and close all instances

### 6. Kiro Account Management

- **Account Import**: OAuth, Token/JSON import, and local import
- **Quota View**: Shows Plan, User Prompt credits, Add-on prompt credits, and cycle information
- **Batch Operations**: Tags and bulk actions
- **Switch Injection**: Supports injecting and launching Kiro after account switch

#### 6.1 Kiro Multi-Instance

Manage Kiro instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: Each instance uses its own user data directory
- **Quick Lifecycle**: Start/stop/force stop instances
- **Window Control**: Open instance windows and close all instances

### 7. Cursor Account Management

- **Account Import**: OAuth, Token/JSON import, and local import
- **Quota View**: Shows Total Usage, Auto + Composer, API Usage, On-Demand, and cycle information
- **Batch Operations**: Tags and bulk actions
- **Switch Injection**: Supports injecting and launching Cursor after account switch

#### 7.1 Cursor Multi-Instance

Manage Cursor instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: Each instance uses its own user data directory
- **Quick Lifecycle**: Start/stop/force stop instances
- **Window Control**: Open instance windows and close all instances

### 8. Gemini Cli Account Management

- **Account Import**: OAuth, Token/JSON import, and local import
- **Quota View**: Shows Total Usage, Auto + Composer, API Usage, On-Demand, and cycle information
- **Batch Operations**: Tags and bulk actions
- **Switch Injection**: Supports injecting Gemini Cli local credentials after account switch (`~/.gemini`)
- **Platform Limitation**: Gemini Cli multi-instance management is not supported yet

### 9. CodeBuddy Account Management

- **Account Import**: OAuth and Token/JSON import
- **Quota View**: quota query, cycle details, and extra-credit display
- **Batch Operations**: tags and bulk actions
- **Switch Injection**: supports injecting and launching CodeBuddy after account switch

#### 9.1 CodeBuddy Multi-Instance

Manage CodeBuddy instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: Each instance uses its own user data directory
- **Quick Lifecycle**: Start/stop/force stop instances
- **Window Control**: Open instance windows and close all instances

### 10. CodeBuddy CN Account Management

- **Account Import**: supports OAuth, Token/JSON import, and local-client import
- **Quota View**: shows plan and usage status, with a shortcut to open detailed quota information on the official web page
- **Batch Operations**: supports tags and bulk actions
- **Switch Injection**: supports writing local auth state back and launching CodeBuddy CN after account switch

#### 10.1 CodeBuddy CN Multi-Instance

Manage CodeBuddy CN instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: each instance uses its own user data directory
- **Quick Lifecycle**: start/stop/force stop instances
- **Window Control**: open instance windows and close all instances

### 11. Qoder Account Management

- **Account Import**: supports local import and JSON import
- **Quota View**: shows Credits usage, remaining credits, and raw plan values
- **Batch Operations**: supports tags, filters, export, and batch delete/refresh
- **Switch Injection**: supports injecting and launching Qoder after account switch

#### 11.1 Qoder Multi-Instance

Manage Qoder instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: each instance uses its own user data directory
- **Quick Lifecycle**: start/stop/force stop instances
- **Window Control**: open instance windows and close all instances

### 12. Trae Account Management

- **Account Import**: supports local import and JSON import
- **Quota View**: shows raw plan values, USD spent/total budget, and reset time
- **Batch Operations**: supports tags, filters, export, and batch delete/refresh
- **Switch Injection**: supports writing back local auth state and launching Trae after account switch

#### 12.1 Trae Multi-Instance

Manage Trae instances with isolated profiles and lifecycle controls.

- **Isolated Profiles**: each instance uses its own user data directory
- **Quick Lifecycle**: start/stop/force stop instances
- **Window Control**: open instance windows and close all instances

### 13. Zed Account Management

- **Account Import**: Supports official OAuth sign-in, JSON import, and importing the current local sign-in state
- **Usage View**: Shows subscription status, Edit Predictions, Token Spend, Spend Limit, and billing period end
- **Batch Operations**: Supports tags, filters, export, and batch delete/refresh
- **Switch Injection**: Applies the selected account back to the official Zed client using the client's real local persistence rules and restarts the client when needed

### 14. General Settings

- **Personalized Settings**: Theme switching, language settings, auto-refresh interval
- **Platform Controls**: Centralized CodeBuddy CN/Qoder/Trae/Zed launch-path and quota-alert settings

> ![Settings](docs/images/settings_page.png)

---

## Security & Privacy (Plain-English)

These are the most common security questions answered directly:

- **This is a local desktop tool**: it does not require a separate cloud account for this project, and it does not rely on a project-hosted cloud account storage.
- **Data is mainly stored on your machine**:
  - `~/.antigravity_cockpit`: Antigravity IDE accounts, configs, WebSocket status, etc.
  - `~/.codex`: official Codex current login `auth.json`, plus Codex provider/config and session state written by Cockpit
  - `~/.gemini`: Gemini Cli local session files (for example `oauth_creds.json`, `google_accounts.json`, `settings.json`)
  - local app data folder under `com.antigravity.cockpit-tools`: Codex / GitHub Copilot / Windsurf / Kiro / Cursor / Gemini Cli / CodeBuddy / CodeBuddy CN / Qoder / Trae / Zed multi-account index data, etc.
- **WebSocket is local-only by default**: binds to `127.0.0.1`, default port `19528`; you can disable it or change the port in Settings.
- **When network access happens**: OAuth login, token refresh, quota fetching, update checks, and other official API requests.
- **macOS privacy permission prompts**: after you start Codex/agent from Cockpit Tools, if an agent-run shell command accesses protected folders such as Desktop, Documents, Downloads, or Photos, macOS may show the request as "Cockpit Tools would like to access...". This happens because those commands are child processes launched by Cockpit Tools, so macOS attributes the request to the host app; it does not by itself mean the Cockpit Tools main process is actively scanning those folders. Grant access only when you trust the current agent task and the commands it is going to run. If unsure, deny the prompt or run the project from a normal working directory first.
- **Practical safety tips**:
  1. If you do not need plugin integration, disable WebSocket.
  2. Do not share your full user directory directly; redact token files before backup/share.
  3. On shared/public computers, remove accounts and quit the app after use.

## Settings Guide (Beginner Friendly)

If you want a stable setup with minimal tuning, follow the "Recommended" values.

### General Settings

| Setting | What it does (simple) | Recommended | When to change |
| --- | --- | --- | --- |
| Display Language | Changes UI language | Your native/comfortable language | Only if current language is hard to read |
| Theme | Light/dark appearance | System | Use dark mode for long night sessions |
| Window Close Behavior | What happens when clicking close | Ask every time | Choose "Minimize to tray" if you want background running |
| Antigravity IDE Auto Refresh | Periodically updates Antigravity IDE quota | 5-10 minutes | Use 2 minutes if you need near real-time updates |
| Codex Auto Refresh | Periodically updates Codex quota | 5-10 minutes | Same as above |
| GitHub Copilot Auto Refresh | Periodically updates GitHub Copilot quota | 5-10 minutes | Same as above |
| Windsurf Auto Refresh | Periodically updates Windsurf quota | 5-10 minutes | Same as above |
| Kiro Auto Refresh | Periodically updates Kiro quota | 5-10 minutes | Same as above |
| Cursor Auto Refresh | Periodically updates Cursor quota | 5-10 minutes | Same as above |
| Gemini Cli Auto Refresh | Periodically updates Gemini Cli quota | 5-10 minutes | Same as above |
| CodeBuddy Auto Refresh | Periodically updates CodeBuddy quota | 5-10 minutes | Same as above |
| CodeBuddy CN Auto Refresh | Periodically updates CodeBuddy CN quota | 5-10 minutes | Same as above |
| Qoder Auto Refresh | Periodically updates Qoder quota | 5-10 minutes | Same as above |
| Trae Auto Refresh | Periodically updates Trae quota | 5-10 minutes | Same as above |
| Zed Auto Refresh | Periodically updates Zed quota | 5-10 minutes | Same as above |
| Data Directory | Where account/config files are stored | Keep default | Only for troubleshooting or backups |
| Antigravity IDE/Codex/VS Code/Windsurf/Kiro/Cursor/Gemini Cli/CodeBuddy/CodeBuddy CN/Qoder/Trae/Zed/OpenCode App Path | Manually set executable path | Leave empty (auto-detect) | Change only if auto-detect fails or you use custom install paths |
| Auto-restart OpenCode on Codex switch | Sync OpenCode auth after Codex switch | ON if you use OpenCode; otherwise OFF | Enable for frequent Codex switching with OpenCode |

Notes:
- Smaller refresh intervals mean more frequent requests.
- If quota-reset wake-up tasks are enabled, some minimum refresh limits may apply (UI will show hints).

### Network Settings

| Setting | What it does (simple) | Recommended | Risk / Notes |
| --- | --- | --- | --- |
| WebSocket Service | Real-time local integration for plugins/clients | OFF if not needed | Still local-only (`127.0.0.1`) when enabled |
| Preferred Port | Listening port for WebSocket | Default `19528` | Change only on conflict; restart required after save |
| Current Running Port | The actual active port | Read-only info | May differ if preferred port is occupied |

### 3 Ready-to-Use Presets

1. **Stable default**: 10-min refresh, WebSocket OFF (if no plugin), keep default paths.  
2. **Frequent switching**: 2-5 min refresh, WebSocket ON if needed, OpenCode sync ON.  
3. **Security-first**: WebSocket OFF, do not share user directory, remove unused accounts regularly.  

---



---

## Installation Guide

### Option A: Manual Download (Recommended)

Go to this repository's [Cockpit Tools Local Releases](https://github.com/sciman-top/cockpit-tools-local/releases) to download self-use builds. Releases here represent `Cockpit Tools Local` only; if the current version has no installable assets yet, build locally with the development flow below instead of treating the official upstream release as this local edition.

*   **macOS**: `.dmg` (Apple Silicon & Intel), when available in this repository's release assets
*   **Windows**: `.msi` (Recommended) or `.exe`, when available in this repository's release assets
*   **Linux**: official Linux assets are not treated as Local release assets by default; build locally when needed

### Option B: Install with Homebrew (macOS)

> The self-use Homebrew cask must point to this repository's self-use release. If the matching cask update has not been published yet, prefer manual download or local build; do not use the official upstream tap as a substitute for Cockpit Tools Local.

```bash
brew tap sciman-top/cockpit-tools-local https://github.com/sciman-top/cockpit-tools-local
brew install --cask cockpit-tools
```

If you hit the macOS "App is damaged" warning, you can also install with `--no-quarantine`:

```bash
brew install --cask --no-quarantine cockpit-tools
```

If Homebrew says the app already exists (e.g. `already an App at '/Applications/Cockpit Tools.app'`), remove the old app and install again:

```bash
rm -rf "/Applications/Cockpit Tools.app"
brew install --cask cockpit-tools
```

Or force overwrite the existing app:

```bash
brew install --cask --force cockpit-tools
```

### 🛠️ Troubleshooting

#### macOS says "App is damaged and can't be opened"?
Due to macOS security mechanisms, apps not downloaded from the App Store may trigger this warning. The current open-source release flow does not yet use Apple Developer ID signing or notarization, so some macOS versions may show stricter Gatekeeper prompts. You can quickly fix this by following these steps:

1.  **Command Line Fix** (Recommended):
    Open Terminal and run the following command:
    ```bash
    sudo xattr -rd com.apple.quarantine "/Applications/Cockpit Tools.app"
    ```
    > **Note**: If you changed the app name, please adjust the path in the command accordingly.

2.  **Or**: Go to "System Settings" -> "Privacy & Security" and click "Open Anyway".

---

## Development & Build

### Prerequisites

- Node.js v18+
- npm v9+
- Rust (Tauri runtime)

### Install Dependencies

```bash
npm install
```

### Development Mode

```bash
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=sciman-top/cockpit-tools-local&type=Date)](https://star-history.com/#sciman-top/cockpit-tools-local&Date)

---

## Community

Newly created Telegram chat group: [Join the group](https://t.me/+Y8gMv4SlZUU2MWY1)

---

## Sponsor

If you find this project useful, consider supporting it here: [☕ Donate](docs/DONATE.en.md)

Every bit of support helps sustain open-source development. Thank you!

---

## Acknowledgments

- Antigravity IDE account switching logic based on: [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager)
- Codex API service sidecar integration: [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

Thanks to the project author for their open-source contributions! If these projects have helped you, please give them a ⭐ Star to show your support!

---

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

- Allowed: personal learning, research, and non-commercial use/modification (with attribution and share-alike obligations).
- Not allowed: any commercial use without authorization (including internal commercial operations, external paid services, paid product integration, or resale/redistribution for profit).
- Commercial license: contact the author for a separate written commercial license and pricing.

---

## Disclaimer

This project is for personal learning and research purposes only. By using this project, you agree to:

- Not use this project for any commercial purposes without prior written authorization from the author
- Bear all risks and responsibilities of using this project
- Comply with relevant terms of service and laws and regulations

The project author is not responsible for any direct or indirect losses arising from the use of this project.
