param()

$ErrorActionPreference = "Stop"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Contains {
  param([string]$Text, [string]$Needle, [string]$Message)
  Assert-True ($Text.Contains($Needle)) $Message
}

function Assert-Matches {
  param([string]$Text, [string]$Pattern, [string]$Message)
  Assert-True ($Text -match $Pattern) $Message
}

function Test-ExecutableDocCommandLine {
  param([string]$Line)
  $Line -match '(?i)(^|\s)(pwsh|powershell|powershell\.exe|pwsh\.exe)\b' -or
    $Line -match '(^|\s)&\s*["'']?' -or
    $Line -match '(^|\s)\.\\scripts\\' -or
    $Line -match '(^|\s)\./scripts/' -or
    $Line -match '(^|\s)-File\s+'
}

function Convert-JsonOutput {
  param([object[]]$Output, [string]$Context)
  $text = ($Output | Out-String).Trim()
  if (-not $text) {
    throw "$Context did not emit JSON"
  }
  $text | ConvertFrom-Json
}

function Get-GuardMarkdownFiles {
  param([string]$Root)

  $files = @()
  foreach ($name in @("README.md", "SECURITY.md", "AGENTS.md")) {
    $path = Join-Path $Root $name
    if (Test-Path -LiteralPath $path) {
      $files += Get-Item -LiteralPath $path
    }
  }

  $docsRoot = Join-Path $Root "docs"
  if (Test-Path -LiteralPath $docsRoot) {
    $files += Get-ChildItem -LiteralPath $docsRoot -Recurse -File -Filter "*.md"
  }

  $files | Sort-Object FullName -Unique
}

function Assert-LiveUpstreamDocExamplesRequireAcknowledgement {
  param([string]$Root)

  $violations = @()
  foreach ($file in Get-GuardMarkdownFiles $Root) {
    $relativePath = [System.IO.Path]::GetRelativePath($Root, $file.FullName)
    $text = Get-Content -LiteralPath $file.FullName -Raw

    $fencedBlocks = [regex]::Matches($text, '```[^\r\n]*\r?\n(?<block>[\s\S]*?)```')
    foreach ($match in $fencedBlocks) {
      $block = $match.Groups["block"].Value
      if ($block -match 'smoke-local-hardened-api\.ps1' -and $block -match '-RunUpstreamSmoke' -and $block -notmatch '-AcknowledgeLiveUpstreamRisk') {
        $violations += "$relativePath fenced smoke command is missing -AcknowledgeLiveUpstreamRisk"
      }
      if ($block -match 'accept-local-hardened-api-continuity\.ps1' -and $block -notmatch '-AcknowledgeLiveUpstreamRisk') {
        $violations += "$relativePath fenced acceptance command is missing -AcknowledgeLiveUpstreamRisk"
      }
    }

    $lines = Get-Content -LiteralPath $file.FullName
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]
      $lineNumber = $i + 1
      $continuesOnNextLine = $line.TrimEnd().EndsWith([string][char]0x60)
      $looksExecutable = Test-ExecutableDocCommandLine $line
      if ($looksExecutable -and -not $continuesOnNextLine -and $line -match 'smoke-local-hardened-api\.ps1' -and $line -match '-RunUpstreamSmoke' -and $line -notmatch '-AcknowledgeLiveUpstreamRisk') {
        $violations += ("{0}:{1} inline smoke command is missing -AcknowledgeLiveUpstreamRisk" -f $relativePath, $lineNumber)
      }
      if ($looksExecutable -and -not $continuesOnNextLine -and $line -match 'accept-local-hardened-api-continuity\.ps1' -and $line -notmatch '-AcknowledgeLiveUpstreamRisk') {
        $violations += ("{0}:{1} inline acceptance command is missing -AcknowledgeLiveUpstreamRisk" -f $relativePath, $lineNumber)
      }
    }
  }

  Assert-True ($violations.Count -eq 0) ("live upstream doc examples missing acknowledgement:`n{0}" -f ($violations -join "`n"))
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$agentsPath = Join-Path $repoRoot "AGENTS.md"
$agents = if (Test-Path -LiteralPath $agentsPath) { Get-Content -LiteralPath $agentsPath -Raw } else { $null }
$doc = Get-Content -LiteralPath (Join-Path $repoRoot "docs\LOCAL_HARDENED_API.md") -Raw
$roadmap = Get-Content -LiteralPath (Join-Path $repoRoot "docs\LOCAL_HARDENED_API_ROADMAP.md") -Raw
$accountPoolPlan = Get-Content -LiteralPath (Join-Path $repoRoot "docs\LOCAL_HARDENED_API_ACCOUNT_POOL_SCHEDULING_PLAN.md") -Raw
$referenceReview = Get-Content -LiteralPath (Join-Path $repoRoot "docs\reference-gateway-best-practices.md") -Raw
$referenceBasisPolicy = Get-Content -LiteralPath (Join-Path $repoRoot "docs\architecture\reference-basis-policy.json") -Raw
$referenceBasisCatalog = Get-Content -LiteralPath (Join-Path $repoRoot "docs\research\reference-basis-catalog.json") -Raw
$referenceBasisMatrix = Get-Content -LiteralPath (Join-Path $repoRoot "docs\research\reference-basis-matrix.md") -Raw
$smoke = Get-Content -LiteralPath (Join-Path $PSScriptRoot "smoke-local-hardened-api.ps1") -Raw
$accept = Get-Content -LiteralPath (Join-Path $PSScriptRoot "accept-local-hardened-api-continuity.ps1") -Raw
$preflight = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\release\preflight.cjs") -Raw
$referenceBasisVerifier = Get-Content -LiteralPath (Join-Path $repoRoot "scripts\verify-reference-basis.py") -Raw
$localAccessModal = Get-Content -LiteralPath (Join-Path $repoRoot "src\components\CodexLocalAccessModal.tsx") -Raw
$accountsPage = Get-Content -LiteralPath (Join-Path $repoRoot "src\pages\CodexAccountsPage.tsx") -Raw
$codexAccountStore = Get-Content -LiteralPath (Join-Path $repoRoot "src\stores\useCodexAccountStore.ts") -Raw
$localAccessService = Get-Content -LiteralPath (Join-Path $repoRoot "src\services\codexLocalAccessService.ts") -Raw
$codexCommand = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\src\commands\codex.rs") -Raw
$tauriLib = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\src\lib.rs") -Raw
$localAccessModule = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\src\modules\codex_local_access.rs") -Raw
$reconnectDiagnostics = Get-Content -LiteralPath (Join-Path $PSScriptRoot "capture-codex-reconnect-diagnostics.ps1") -Raw

if ($agents) {
  Assert-Contains $agents "AcknowledgeLiveUpstreamRisk" "AGENTS.md must require live upstream acknowledgement"
  Assert-Contains $agents "AcknowledgeExpandedLiveUpstreamRisk" "AGENTS.md must require expanded live upstream acknowledgement"
  Assert-Contains $agents "Cooldown recovery must be inferred from stored reset times/health registry" "AGENTS.md must forbid cooldown polling by default"
  Assert-Contains $agents 'Official `openai-codex` source is the highest reference' "AGENTS.md must preserve official Codex source priority when present"
  Assert-Contains $agents "pool scheduling, sorting, or risk-reduction changes" "AGENTS.md must cover pool scheduling/sorting/risk-reduction when present"
  Assert-Contains $agents "git fetch --prune" "AGENTS.md must require refreshing stale local reference sources when present"
  Assert-True ($agents -notmatch "AutoPopulateProbeAccountPool") "AGENTS.md must not document removed auto-populate pool mode"
}

Assert-Contains $doc "AcknowledgeLiveUpstreamRisk" "LOCAL_HARDENED_API.md must show live upstream acknowledgement"
Assert-Contains $doc "AcknowledgeExpandedLiveUpstreamRisk" "LOCAL_HARDENED_API.md must show expanded live upstream acknowledgement"
Assert-Contains $doc '官方 `openai-codex` 源码' "LOCAL_HARDENED_API.md must preserve official Codex source priority"
Assert-Contains $doc "号池调度、排序和风控降噪" "LOCAL_HARDENED_API.md must cover pool scheduling, sorting, and risk reduction"
Assert-True ($doc -notmatch "AutoPopulateProbeAccountPool") "LOCAL_HARDENED_API.md must not document removed auto-populate pool mode"
Assert-True ($doc -notmatch "自动号池") "LOCAL_HARDENED_API.md must not document automatic probe pool population"
Assert-Contains $roadmap '官方 `openai-codex`' "roadmap must list official Codex source as a local reference"
Assert-Contains $roadmap "号池调度、排序和抗风控风险" "roadmap must preserve pool scheduling/sorting/risk evidence chain"
Assert-Contains $accountPoolPlan '官方 `openai-codex` 源码' "account pool plan must prioritize official Codex source"
Assert-Contains $accountPoolPlan "调度、排序、风控降噪" "account pool plan must explicitly cover scheduling, sorting, and risk reduction"
Assert-Contains $accountPoolPlan "Sub2API/CLIProxyAPI/LiteLLM/New API" "account pool plan must keep local reference projects in scope"
Assert-Contains $accountPoolPlan "变更准入要求" "account pool plan must require reference review before changes"
Assert-Contains $referenceReview "OpenAI Codex" "reference review must include official openai-codex snapshot"
Assert-Contains $referenceReview "Evidence Precedence" "reference review must define evidence precedence"
Assert-Contains $referenceReview "如果官方 Codex 源码与社区网关实践冲突" "reference review must resolve official-vs-community conflicts"
Assert-Contains $referenceReview "Official Codex Anchors" "reference review must pin official Codex source anchors"
Assert-Contains $referenceReview "codex-rs/codex-api/src/sse/responses.rs" "reference review must pin official Responses SSE terminal handling"
Assert-Contains $referenceReview "ResponseStreamDisconnected" "reference review must pin official mid-turn stream disconnect semantics"
Assert-Contains $referenceReview "previous_response_id" "reference review must pin official continuation semantics"
Assert-Contains $referenceReview "TurnContext.turn_id" "reference review must pin official turn identity semantics"
Assert-Contains $referenceReview "previous_response_not_found" "reference review must pin official full-context retry guidance"
Assert-Contains $referenceBasisPolicy "codex-protocol-and-continuity" "reference-basis policy must guard Codex protocol and continuity surfaces"
Assert-Contains $referenceBasisPolicy "local-hardened-api-routing-and-risk" "reference-basis policy must guard local hardened API routing and risk surfaces"
Assert-Contains $referenceBasisPolicy "reference-and-release-gate-boundaries" "reference-basis policy must guard reference/release gate surfaces"
Assert-Contains $referenceBasisCatalog "openai-openapi" "reference-basis catalog must include official OpenAPI semantics"
Assert-Contains $referenceBasisCatalog "cockpit-tools-upstream" "reference-basis catalog must include upstream Cockpit baseline"
Assert-Contains $referenceBasisMatrix "scripts/verify-reference-basis.py" "reference-basis matrix must point to the verifier"
Assert-Contains $referenceBasisMatrix "reference_basis_review" "reference-basis matrix must define evidence tokens"
Assert-Contains $referenceBasisVerifier "missing_reference_basis_evidence" "reference-basis verifier must fail closed without evidence"
Assert-Contains $referenceBasisVerifier "reference_basis_evidence_incomplete" "reference-basis verifier must fail closed for incomplete evidence"
Assert-LiveUpstreamDocExamplesRequireAcknowledgement $repoRoot

Assert-Contains $smoke "live_upstream_risk_ack_required" "smoke script must fail closed without live acknowledgement"
Assert-Contains $smoke "expanded_live_upstream_risk_ack_required" "smoke script must fail closed for expanded live risk"
Assert-True ($smoke -notmatch "AutoPopulateProbeAccountPool") "smoke script must not expose removed auto-populate pool switch"
Assert-True ($smoke -notmatch "AutoPopulateProbeMaxRefreshAttempts") "smoke script must not expose removed auto-populate refresh switch"
Assert-Matches $smoke '\[int\]\$AutoDrainRequestIntervalSeconds\s*=\s*22' "smoke script must keep drain interval default at 22 seconds"
Assert-Matches $smoke '\$AutoDrainFirstFreeAccountUntilFallback\s+-and\s+\$AutoDrainRequestIntervalSeconds\s+-lt\s+20' "smoke script must guard drain intervals below 20 seconds"

Assert-Contains $accept "live_upstream_risk_ack_required" "acceptance wrapper must fail closed without live acknowledgement"
Assert-Contains $accept "expanded_live_upstream_risk_ack_required" "acceptance wrapper must fail closed for expanded live risk"
Assert-Contains $accept '"-AcknowledgeLiveUpstreamRisk"' "acceptance wrapper must pass live acknowledgement to smoke script"
Assert-Contains $accept '"-AcknowledgeExpandedLiveUpstreamRisk"' "acceptance wrapper must pass expanded acknowledgement to smoke script"
Assert-Contains $accept "continuitySummary" "acceptance wrapper must surface the two-part continuity summary"
Assert-Contains $smoke "new_request_avoids_exhausted_account" "smoke report must check that later requests avoid exhausted/cooldown accounts"
Assert-Contains $smoke "New-SmokeContinuitySummary" "smoke report must emit the two-part continuity summary"
Assert-Contains $smoke 'ProcessName -ceq $name' "Codex App process guard must use exact process-name matching so nested lowercase codex CLI probes do not fail App stability"
Assert-Contains $preflight "test-local-hardened-api-live-risk-guard.ps1" "release preflight must run the local hardened API live-risk guard"
Assert-Contains $preflight "verify-reference-basis.py" "release preflight must run the reference-basis guard"
Assert-Contains $preflight "check-merge-conflict-markers.ps1" "release preflight must block unresolved merge conflict markers"
Assert-Contains $preflight "test-codex-api-service-continuity-focus.ps1" "release preflight must run Codex API service continuity focused tests"
Assert-Contains $localAccessModal "balancedSelfUseDesc" "API service safety presets must keep the balanced self-use label visible"
Assert-Contains $localAccessModal "quotaDrainCarefulDesc" "API service safety presets must keep the quota-drain label visible"
Assert-Contains $localAccessModal "opt-in" "API service safety presets must label low-rate/drain modes as manual opt-in"
Assert-Contains $localAccessModal "maxRetryAccountsManualOptIn" "API service panel must detect maxRetryAccounts > 2 as manual opt-in"
Assert-Contains $localAccessModal "maxRetryAccounts &gt; 2" "API service panel must display maxRetryAccounts > 2 as manual opt-in"
Assert-Contains $localAccessModal "health?.exhaustedCount" "API service health panel must display quota-exhausted account count"
Assert-Contains $localAccessModal "health?.disabledCount" "API service health panel must display manually paused account count"
Assert-Contains $localAccessModal "handlePauseHealth" "API service member UI must expose explicit manual pause action"
Assert-Contains $localAccessModal "不刷新额度也不访问上游" "manual pause confirmation must state it does not refresh quota or call upstream"
Assert-True ($localAccessModal -notmatch "forceDirectProjection") "runtime-mode dropdown must not force Direct Projection by default"
Assert-True ($localAccessModal -notmatch "force:\s*isDirectProjection") "runtime-mode dropdown must let backend continuity guards decide Direct Projection safety"
Assert-True ($accountsPage -notmatch 'handleSetCodexRuntimeMode\("direct_projection",\s*\{\s*force:\s*true\s*\}\)') "quick local-access toggle must not force Direct Projection by default"
Assert-True ($accountsPage -notmatch 'setCodexLocalAccessEnabled\(\s*nextEnabled,\s*\{\s*force\s*\}\s*\)') "local-access enable toggle must not bypass continuity guards with force by default"
Assert-Contains $accountsPage "isCodexContinuityProtectionError" "accounts page must detect continuity protection errors before offering force retry"
Assert-Contains $accountsPage 'requestCodexContinuityForceSwitch("account")' "accounts page must require explicit confirmation before forced account switch retry"
Assert-Contains $accountsPage 'requestCodexContinuityForceSwitch("runtime")' "accounts page must require explicit confirmation before forced runtime-mode retry"
Assert-Contains $accountsPage "handleSetCodexRuntimeModeWithContinuityRetry" "runtime-mode UI must route through continuity-aware retry wrapper"
Assert-Contains $accountsPage "handleActivateLocalAccessWithContinuityRetry" "API service activation must route through continuity-aware retry wrapper"
Assert-Contains $localAccessService "activateCodexLocalAccess(options?: {" "frontend service must expose forceable API service activation"
Assert-Contains $localAccessService "force: options?.force ?? false" "frontend service must pass activation force through to Tauri"
Assert-Contains $codexCommand "codex_local_access_activate(" "Tauri command layer must expose forceable API service activation"
Assert-Contains $codexCommand "RuntimeProjectionChangeOptions::new(" "backend activation must construct runtime projection options"
Assert-Contains $codexCommand "force.unwrap_or(false)" "backend activation must honor explicit force retries"
Assert-Contains $codexAccountStore "switchAccount: (accountId: string, options?: { force?: boolean })" "Codex account store must expose explicit force switch option"
Assert-Contains $codexAccountStore "codexService.switchCodexAccount(accountId, {" "Codex account store must pass force switch option to backend service"
Assert-Contains $localAccessService "pauseCodexLocalAccessHealth" "frontend service must expose local health pause command"
Assert-Contains $localAccessService "codex_local_access_pause_health" "frontend service must invoke local health pause command"
Assert-Contains $codexCommand "codex_local_access_pause_health" "Tauri command layer must expose local health pause command"
Assert-Contains $tauriLib "codex_local_access_pause_health" "Tauri invoke handler must register local health pause command"
Assert-Contains $localAccessModule "pause_local_access_health" "backend must implement local health pause command"
Assert-Contains $localAccessModule "record_manual_pause_audit_event" "manual pause must write a redacted audit event"
Assert-Contains $localAccessModule "manual_paused" "manual pause must mark local health without upstream probing"
Assert-Contains $reconnectDiagnostics "localRequestAuditEventCount" "reconnect diagnostics must distinguish request/stream audit events from runtime projection events"

$smokeBlockedOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "smoke-local-hardened-api.ps1") `
  -Stage single `
  -RunUpstreamSmoke 2>$null
Assert-True ($LASTEXITCODE -ne 0) "smoke script should block live upstream smoke without acknowledgement"
$smokeBlocked = Convert-JsonOutput $smokeBlockedOutput "smoke live-risk block"
Assert-True ($smokeBlocked.overall -eq "blocked") "smoke live-risk block should report blocked"
Assert-True ($smokeBlocked.reason -eq "live_upstream_risk_ack_required") "smoke live-risk block should require acknowledgement"

$smokeExpandedBlockedOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "smoke-local-hardened-api.ps1") `
  -Stage fallback_probe `
  -AutoDrainFirstFreeAccountUntilFallback `
  -AutoDrainMaxRequests 31 `
  -AcknowledgeLiveUpstreamRisk 2>$null
Assert-True ($LASTEXITCODE -ne 0) "smoke script should block expanded refresh attempts without expanded acknowledgement"
$smokeExpandedBlocked = Convert-JsonOutput $smokeExpandedBlockedOutput "smoke expanded-risk block"
Assert-True ($smokeExpandedBlocked.overall -eq "blocked") "smoke expanded-risk block should report blocked"
Assert-True ($smokeExpandedBlocked.reason -eq "expanded_live_upstream_risk_ack_required") "smoke expanded-risk block should require expanded acknowledgement"

$acceptBlockedOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "accept-local-hardened-api-continuity.ps1") 2>$null
Assert-True ($LASTEXITCODE -ne 0) "acceptance wrapper should block without live acknowledgement"
$acceptBlocked = Convert-JsonOutput $acceptBlockedOutput "acceptance live-risk block"
Assert-True ($acceptBlocked.overall -eq "blocked") "acceptance live-risk block should report blocked"
Assert-True ($acceptBlocked.reason -eq "live_upstream_risk_ack_required") "acceptance live-risk block should require acknowledgement"

"PASS local hardened API live-risk guard tests"
