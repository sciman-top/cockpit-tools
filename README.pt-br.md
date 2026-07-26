# Cockpit Tools Local

[English](README.en.md) · Portuguese (BR) · [简体中文](README.md)

[![GitHub release](https://img.shields.io/github/v/release/sciman-top/cockpit-tools-local?style=flat)](https://github.com/sciman-top/cockpit-tools-local/releases)

## Comece por Aqui

Este repositório é um fork pessoal de uso próprio de [`jlcodes99/cockpit-tools`](https://github.com/jlcodes99/cockpit-tools), e não o repositório oficial de releases upstream. A página inicial, os releases, os números de versão, os instaladores e as proteções de runtime seguem a semântica de uso próprio do `Cockpit Tools Local`.

| Área | Cockpit Tools Local | Upstream oficial |
| --- | --- | --- |
| Identidade do repositório e do produto | `sciman-top/cockpit-tools-local`, nome do produto `Cockpit Tools Local`, Tauri identifier `com.sciman.cockpit-tools-local` | Identidade oficial `jlcodes99/cockpit-tools` |
| Versionamento e releases | Usa `official-base + -local.N`; os releases publicam apenas builds de uso próprio e não espelham instaladores oficiais | Usa versões e artefatos oficiais |
| Absorção de upstream | `main` continua sendo a linha self-use; o código oficial entra via `upstream/main` e só é mesclado após revisão isolada | Linha oficial de desenvolvimento |
| Melhorias locais do Codex | Mantém Local API Service, hardened gateway, roteamento por pool/follow-current, provider projection, session visibility, quota/cooldown e guardas de continuidade | Segue o comportamento oficial padrão |
| Segurança e limites de runtime | Live upstream probes, drains, execuções de app/server de desenvolvimento e troca de release exe exigem confirmação explícita; sessões atuais de Codex/Cockpit não são interrompidas automaticamente | Esses guardas locais não fazem parte do upstream |

## Estado Atual do Projeto

Data de referência do repositório: `2026-06-13`

- A versão self-use atual é `0.24.12-local.1`, e `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json` já estão alinhados.
- A postura atual de release é `Windows-first`: um painel desktop self-use mais um Hardened API Runtime local que, por padrão, escuta em `127.0.0.1`.
- As evidências de baixo risco já estão reaproveitáveis: browser-preview UI smoke, explainability de recent-audit, probes isolados de loopback listener, smoke upstream isolado de conta única e guardas de continuidade para `~/.codex` / `Codex App`.
- A governança de referências agora tem um contrato `reference-basis`: mudanças em surfaces guardadas precisam enviar evidência nomeada de revisão da shelf local e passar em `scripts/verify-reference-basis.py`.
- O limite honesto ainda está aberto: em `2026-06-09`, o chat upstream isolado de conta única já passou, mas o contrato principal de continuity/fallback para small-pool ainda não fechou. Mesmo com drain limitado, o repositório ainda não observou a cadeia `usage_limit_reached -> model_cooldown_applied -> fallback_blocked`, então o fechamento por hard-affinity na mesma tarefa e o desvio de novas requisições para longe de contas exhausted/cooldown continuam `blocked`.
- Tray / notification / prompts de live continuity também não estão fechados e ainda exigem live acceptance explícito.

Entradas de evidência:

- [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
- [live-acceptance-blockers-20260607.md](reports/local-hardened-api-smoke/live-acceptance-blockers-20260607.md)
- [smoke-20260609-002356.json](reports/local-hardened-api-smoke/smoke-20260609-002356.json)
- [smoke-20260609-012423.json](reports/local-hardened-api-smoke/smoke-20260609-012423.json)

## Capacidades Principais

O Cockpit Tools Local atualmente suporta 12 plataformas:

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

Capacidades centrais:

- Importação, troca, agrupamento, operações em lote e monitoramento de cotas para múltiplas contas
- Fluxos de múltiplas instâncias com diretórios de usuário isolados
- Alternância entre Codex Direct OAuth / API Key / Local API Service
- Provider projection, reparo de session visibility, estado de saúde do pool e cooldown registry
- Hardened local API mode, evidências stream/audit com redação e defaults de baixo risco
- Entradas locais Windows-first, fluxo de release self-use e absorção compatível do modelo sidecar do CLIProxyAPI oficial

Observações:

- Gemini Cli ainda não suporta múltiplas instâncias.
- OpenCode é atualmente uma integração complementar, não uma das 12 plataformas listadas acima.
- A interface já inclui 18 idiomas, incluindo English, 简体中文, 繁體中文, 日本語, Deutsch, Español, Français, Italiano, 한국어, Português, Русский, Türkçe, Polski, Čeština, العربية, Tiếng Việt, Bahasa Indonesia e o locale de compatibilidade `en-US`.

## Mapa da Documentação

Ordem recomendada de leitura:

1. [README.md](README.md)
2. [SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md)
3. [UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)
4. [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
5. [LOCAL_HARDENED_API.md](docs/LOCAL_HARDENED_API.md)
6. [COCKPIT_LOCAL_TARGET_ARCHITECTURE.md](docs/COCKPIT_LOCAL_TARGET_ARCHITECTURE.md)
7. [CHANGELOG.md](CHANGELOG.md)

Entradas por assunto:

- Codex local API / Hardened API: [LOCAL_HARDENED_API.md](docs/LOCAL_HARDENED_API.md)
- Verdade atual do release acceptance: [LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md](docs/LOCAL_HARDENED_API_RELEASE_ACCEPTANCE_SUMMARY.md)
- Blockers restantes / truth boundary: [LOCAL_HARDENED_API_NEXT_PHASE_BACKLOG.md](docs/LOCAL_HARDENED_API_NEXT_PHASE_BACKLOG.md)
- Absorção de upstream e delta local: [SELF_USE_DELTA.md](docs/SELF_USE_DELTA.md), [UPSTREAM_SYNC_POLICY.md](docs/UPSTREAM_SYNC_POLICY.md)
- Reference shelf local e snapshots de fonte: [reference-sources.md](docs/reference-sources.md)
- Contrato reference-basis: [reference-basis-policy.json](docs/architecture/reference-basis-policy.json), [reference-basis-catalog.json](docs/research/reference-basis-catalog.json), [reference-basis-matrix.md](docs/research/reference-basis-matrix.md)
- Builds locais em Ubuntu / WSL2: [build-wsl2-ubuntu24.md](docs/build-wsl2-ubuntu24.md)

## Início Rápido

### Pré-requisitos

- Node.js 18+
- npm 9+
- Rust stable

### Instalar dependências

```bash
npm install
```

### Iniciar o perfil de desenvolvimento

```bash
npm run typecheck
npm run tauri:dev
```

`npm run tauri:dev` inicia o perfil isolado `Cockpit Tools Dev`, sem sobrescrever o diretório de dados self-use padrão.

## Comandos Comuns

| Comando | Finalidade |
| --- | --- |
| `npm run typecheck` | Feedback rápido de TypeScript |
| `npm run build` | Build do frontend com sync de versão e typecheck |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Testes Rust de biblioteca |
| `npm run release:preflight` | Release preflight completo |
| `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test` | Somente verificações de contrato/invariantes |
| `python scripts/verify-reference-basis.py` | Verifica se mudanças em surfaces guardadas incluem evidência nomeada de revisão da shelf local |
| `npm run tauri:dev` | Inicia o perfil desktop de desenvolvimento |
| `npm run tauri -- build` | Executa o wrapper de empacotamento do Tauri |
| `npm run preview -- --host 127.0.0.1 --port 4173` | Preview só do frontend para browser-preview smoke |

Ordem padrão de gate neste repositório:

1. `npm run build`
2. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
3. `node scripts/release/preflight.cjs --skip-typecheck --skip-build --skip-cargo --skip-cargo-test`
4. Hotspot review de `SECURITY.md`, `src-tauri/capabilities/`, release scripts, quota/cooldown/pool routing, i18n e limites de continuidade live

## Instalação

### Download manual

Baixe os builds self-use em [Cockpit Tools Local Releases](https://github.com/sciman-top/cockpit-tools-local/releases). Os releases daqui representam apenas `Cockpit Tools Local`. Se a versão atual ainda não tiver instaladores publicados, faça o build localmente pelo fluxo acima em vez de tratar os releases oficiais como esta edição local.

- macOS: `.dmg`
- Windows: `.msi` ou `.exe`
- Linux: os assets Linux oficiais não são tratados como assets da edição Local por padrão; faça build local quando necessário

### Homebrew (macOS)

```bash
brew tap sciman-top/cockpit-tools-local https://github.com/sciman-top/cockpit-tools-local
brew install --cask cockpit-tools
```

Se o cask self-use ainda não estiver atualizado, prefira download manual ou build local em vez do tap upstream oficial.

## Segurança e Privacidade

- Esta é uma ferramenta desktop local; os dados de conta ficam principalmente na sua própria máquina.
- O WebSocket escuta em `127.0.0.1` por padrão, na porta `19528`.
- O hardened default do Codex cobre apenas loopback; escuta em LAN é opt-in avançado, não recomendação padrão.
- Login OAuth, refresh de token, consulta de cotas e checagem de atualização acessam serviços upstream oficiais.
- Não compartilhe o diretório inteiro do usuário diretamente; remova ou masque arquivos de token / auth antes.

Raízes locais comuns:

- `~/.antigravity_cockpit`
- `~/.codex`
- `~/.gemini`
- diretórios locais de app-data sob `com.antigravity.cockpit-tools*`

## Notas de Desenvolvimento

- Checks de baixo risco como `npm run typecheck`, `npm run build`, testes Cargo e focused checks devem rodar normalmente.
- Comandos que iniciam ou reiniciam fluxos live de app/server, como `npm run dev`, `npm run tauri:dev`, `npm run tauri -- build`, ou smoke/drain que consomem cota real de upstream, devem ser tratados como ações de maior risco e explicados antes da execução.
- Não pare, reinicie, mate ou relance automaticamente `Codex App`, `codex`, binários release do Cockpit ou o app/server live atual sem confirmação explícita.
- Antes de mexer em Codex API service, routing, quota continuity, pool scheduling ou failover, consulte [reference-sources.md](docs/reference-sources.md) e o reference shelf local primeiro.

## Comunidade

- Telegram: [Entrar no grupo](https://t.me/+Y8gMv4SlZUU2MWY1)

## Apoio

Se este projeto ajudar você, pode apoiar aqui: [☕ Doar](docs/DONATE.pt-br.md)

## Agradecimentos

- Referência para troca de contas do Antigravity IDE: [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager)
- Referência para o sidecar do Codex API service: [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

## Licença

Este projeto usa [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).

- Permitido: uso pessoal para aprendizado, pesquisa e uso/modificação não comercial
- Não permitido: uso comercial sem autorização
- Licença comercial: entre em contato com o autor para autorização por escrito

## Aviso Legal

Este projeto é apenas para aprendizado e pesquisa pessoal. Ao utilizá-lo, você concorda em:

- não usar o projeto comercialmente sem autorização prévia por escrito
- aceitar os riscos e responsabilidades do uso
- cumprir os termos, leis e regulamentos aplicáveis
