param(
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$referenceRoot = "D:\\CODE\\external\\Cockpit-Tools-Local-references"
$today = Get-Date -Format "yyyy-MM-dd"

$allReferences = @(
  [ordered]@{
    Label = "OpenAI Codex"
    Directory = "openai-codex"
    ExpectedBranch = "main"
    Purpose = '官方 Codex CLI 源码；`/v1/responses`、stream terminal、turn metadata、`previous_response_id`、provider/model/config 行为'
  },
  [ordered]@{
    Label = "CLIProxyAPI"
    Directory = "CLIProxyAPI"
    ExpectedBranch = "main"
    Purpose = 'CLI/OAuth 代理、本地 API sidecar、fill-first、session affinity、首字节后不重试边界'
  },
  [ordered]@{
    Label = "Sub2API"
    Directory = "sub2api"
    ExpectedBranch = "main"
    Purpose = '账号健康状态机、persistent cooldown、sticky 会话、临时不可调度'
  },
  [ordered]@{
    Label = "New API"
    Directory = "new-api"
    ExpectedBranch = "main"
    Purpose = '渠道网关、渠道禁用、重试、限流、统一入口和 backpressure 结构'
  },
  [ordered]@{
    Label = "LiteLLM"
    Directory = "litellm"
    ExpectedBranch = "litellm_internal_staging"
    Purpose = '通用 router、pre-call rate checks、cooldown matrix、proxy observability'
  },
  [ordered]@{
    Label = "Cockpit Tools Upstream"
    Directory = "cockpit-tools-upstream"
    ExpectedBranch = "main"
    Purpose = '官方原版 Cockpit Tools 只读镜像，便于与当前本地 fork 做纯净对照'
  },
  [ordered]@{
    Label = "Tauri"
    Directory = "tauri"
    ExpectedBranch = "dev"
    Purpose = 'Tauri 2 核心源码，适合核对 capability、window lifecycle、updater 和 runtime 语义'
  },
  [ordered]@{
    Label = "Official Tauri Plugins"
    Directory = "plugins-workspace"
    ExpectedBranch = "v2"
    Purpose = '官方插件实现，适合对照 `dialog/fs/opener/process/updater/single-instance/deep-link/autostart`'
  }
)

$gatewayReferences = @(
  "OpenAI Codex"
  "New API"
  "Sub2API"
  "CLIProxyAPI"
  "LiteLLM"
)

function Get-RepoSnapshot {
  param(
    [hashtable]$Entry
  )

  $path = Join-Path $referenceRoot $Entry.Directory
  if (-not (Test-Path (Join-Path $path ".git"))) {
    throw "Reference repo missing or not a git repo: $path"
  }

  $branch = (git -C $path branch --show-current | Out-String).Trim()
  $sha = (git -C $path rev-parse --short=9 HEAD | Out-String).Trim()
  $statusOutput = git -C $path status --porcelain | Out-String
  $dirty = -not [string]::IsNullOrWhiteSpace($statusOutput)

  [ordered]@{
    Label = $Entry.Label
    Directory = $Entry.Directory
    Path = $path
    Branch = $branch
    ExpectedBranch = $Entry.ExpectedBranch
    Revision = $sha
    BranchMatches = ($branch -eq $Entry.ExpectedBranch)
    Status = if ($dirty) { "dirty" } else { "clean" }
    Purpose = $Entry.Purpose
  }
}

function Replace-MarkedBlock {
  param(
    [string]$Text,
    [string]$Marker,
    [string]$Body
  )

  $begin = "<!-- BEGIN:$Marker -->"
  $end = "<!-- END:$Marker -->"
  $pattern = "(?s)$([regex]::Escape($begin)).*?$([regex]::Escape($end))"
  $replacement = "$begin`r`n$Body`r`n$end"
  if ($Text -notmatch [regex]::Escape($begin)) {
    throw "Marker not found: $Marker"
  }
  return [regex]::Replace($Text, $pattern, $replacement)
}

function Get-ReferenceTableRows {
  param(
    [object[]]$Snapshots
  )

  $rows = foreach ($snapshot in $Snapshots) {
    '| {0} | `{1}` | `{2}` | `{3}` | {4} |' -f `
      $snapshot.Label, `
      $snapshot.Path, `
      $snapshot.Branch, `
      $snapshot.Revision, `
      $snapshot.Purpose
  }
  return ($rows -join "`r`n")
}

function Get-GatewayTableRows {
  param(
    [object[]]$Snapshots
  )

  $rows = foreach ($snapshot in $Snapshots) {
    $status = if ($snapshot.BranchMatches) {
      $snapshot.Status
    }
    else {
      "{0}; branch-mismatch(expected {1})" -f $snapshot.Status, $snapshot.ExpectedBranch
    }

    '| {0} | `{1}` | `{2}` | {3} |' -f `
      $snapshot.Label, `
      $snapshot.Branch, `
      $snapshot.Revision, `
      $status
  }
  return ($rows -join "`r`n")
}

$snapshots = foreach ($entry in $allReferences) {
  Get-RepoSnapshot -Entry $entry
}

$referenceSourcesPath = Join-Path $repoRoot "docs\\reference-sources.md"
$referenceGatewayPath = Join-Path $repoRoot "docs\\reference-gateway-best-practices.md"

$referenceRows = Get-ReferenceTableRows -Snapshots $snapshots
$gatewayRows = Get-GatewayTableRows -Snapshots ($snapshots | Where-Object { $gatewayReferences -contains $_.Label })

$referenceSourcesContent = Get-Content $referenceSourcesPath -Raw
$referenceSourcesContent = [regex]::Replace(
  $referenceSourcesContent,
  "更新时间：\d{4}-\d{2}-\d{2}",
  "更新时间：$today"
)
$referenceSourcesContent = Replace-MarkedBlock -Text $referenceSourcesContent -Marker "reference-current-rows" -Body $referenceRows

$referenceGatewayContent = Get-Content $referenceGatewayPath -Raw
$referenceGatewayContent = [regex]::Replace(
  $referenceGatewayContent,
  "## Current Source Snapshot \(\d{4}-\d{2}-\d{2}\)",
  "## Current Source Snapshot ($today)"
)
$referenceGatewayContent = Replace-MarkedBlock -Text $referenceGatewayContent -Marker "gateway-current-rows" -Body $gatewayRows

$referenceChanged = ($referenceSourcesContent -ne (Get-Content $referenceSourcesPath -Raw))
$gatewayChanged = ($referenceGatewayContent -ne (Get-Content $referenceGatewayPath -Raw))

if ($Apply) {
  if ($referenceChanged) {
    Set-Content -Path $referenceSourcesPath -Value $referenceSourcesContent -Encoding UTF8
  }
  if ($gatewayChanged) {
    Set-Content -Path $referenceGatewayPath -Value $referenceGatewayContent -Encoding UTF8
  }
}

$result = [ordered]@{
  reference_root = $referenceRoot
  reference_sources_path = $referenceSourcesPath
  reference_gateway_path = $referenceGatewayPath
  apply = [bool]$Apply
  reference_sources_changed = $referenceChanged
  reference_gateway_changed = $gatewayChanged
  snapshots = $snapshots
}

$result | ConvertTo-Json -Depth 6
