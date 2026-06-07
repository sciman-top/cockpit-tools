function ConvertTo-LocalHardenedApiRedactedText {
  param(
    [AllowNull()][string]$Value,
    [int]$MaxLength = 1200
  )

  if ($null -eq $Value -or $Value -eq "") {
    return $Value
  }

  $text = [string]$Value
  $text = $text -replace '(?i)(authorization\s*:\s*bearer\s+)[^\s"''`r`n]+', '$1[redacted-api-key]'
  $text = $text -replace 'agt_codex_[A-Za-z0-9]+', '[redacted-api-key]'
  $text = $text -replace 'sk-[A-Za-z0-9_-]+', '[redacted-api-key]'
  $text = $text -replace '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[redacted-email]'
  $text = $text -replace 'codex_[0-9a-fA-F]{32}', '[redacted-account-id]'
  if ($text.Length -gt $MaxLength) {
    return $text.Substring(0, $MaxLength) + "...[truncated]"
  }
  $text
}

function Get-LocalHardenedApiDataRootInventory {
  param(
    [AllowNull()][string]$Path,
    [int]$MaxFiles = 20
  )

  $summary = [ordered]@{
    exists = [bool]($Path -and (Test-Path -LiteralPath $Path))
    path = $Path
    fileCount = 0
    files = @()
  }
  if (-not $summary.exists) {
    return $summary
  }

  $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName)
  $summary.fileCount = $files.Count
  $summary.files = @(
    $files |
      Select-Object -First $MaxFiles |
      ForEach-Object {
        [ordered]@{
          name = [System.IO.Path]::GetRelativePath($Path, $_.FullName)
          length = $_.Length
          lastWriteTime = $_.LastWriteTime.ToString("o")
        }
      }
  )
  $summary
}

function Get-LocalHardenedApiJsonSummary {
  param([AllowNull()][string]$Path)

  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{
      exists = $false
      path = $Path
    }
  }

  $item = Get-Item -LiteralPath $Path
  $summary = [ordered]@{
    exists = $true
    path = $Path
    length = $item.Length
    lastWriteTime = $item.LastWriteTime.ToString("o")
  }

  try {
    $json = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $summary.schemaVersion = $json.schemaVersion
    $summary.accountCount = if ($json.accounts) { ($json.accounts.PSObject.Properties | Measure-Object).Count } else { 0 }
    $summary.modelCooldownCount = if ($json.modelCooldowns) { ($json.modelCooldowns.PSObject.Properties | Measure-Object).Count } else { 0 }
    $summary.stickyBindingCount = if ($json.stickyBindings) { ($json.stickyBindings.PSObject.Properties | Measure-Object).Count } else { 0 }
    $summary.lastGlobalError = if ($json.lastGlobalError) { [string]$json.lastGlobalError.errorType } else { $null }
  } catch {
    $summary.parseError = $_.Exception.Message
  }

  $summary
}

function Get-LocalHardenedApiAuditSummary {
  param(
    [AllowNull()][string]$Path,
    [int]$Tail = 120
  )

  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{
      exists = $false
      path = $Path
    }
  }

  $item = Get-Item -LiteralPath $Path
  $events = @()
  Get-Content -LiteralPath $Path -Tail $Tail | ForEach-Object {
    try {
      $events += ($_ | ConvertFrom-Json)
    } catch {
    }
  }
  $attemptedAccountHashes = @(
    $events |
      ForEach-Object { $_.accountHash } |
      Where-Object { $_ -and [string]$_ -ne "-" } |
      Select-Object -Unique
  )

  [ordered]@{
    exists = $true
    path = $Path
    length = $item.Length
    lastWriteTime = $item.LastWriteTime.ToString("o")
    phases = @($events | ForEach-Object { $_.phase } | Where-Object { $_ } | Select-Object -Unique)
    errorTypes = @($events | ForEach-Object { $_.errorType } | Where-Object { $_ } | Select-Object -Unique)
    statuses = @($events | ForEach-Object { $_.status } | Where-Object { $null -ne $_ } | Select-Object -Unique)
    attemptedAccountCount = $attemptedAccountHashes.Count
    attemptedAccountHashes = @($attemptedAccountHashes)
    hasSensitiveMarkers = [bool](@($events | ConvertTo-Json -Depth 8) -match '(authorization|cookie|token|api[_-]?key|sk-[A-Za-z0-9])')
  }
}

function Get-LocalHardenedApiTextFileSummary {
  param(
    [AllowNull()][string]$Path,
    [int]$TailLines = 40
  )

  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{
      exists = $false
      path = $Path
    }
  }

  $item = Get-Item -LiteralPath $Path
  $tailPreview = $null
  try {
    $tailPreview = ConvertTo-LocalHardenedApiRedactedText ((Get-Content -LiteralPath $Path -Tail $TailLines) -join "`n")
  } catch {
    $tailPreview = $null
  }

  [ordered]@{
    exists = $true
    path = $Path
    length = $item.Length
    lastWriteTime = $item.LastWriteTime.ToString("o")
    tailLineCount = $TailLines
    tailPreview = $tailPreview
  }
}

function Get-LocalHardenedApiSqliteSummary {
  param([AllowNull()][string]$Path)

  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{
      exists = $false
      path = $Path
    }
  }

  $item = Get-Item -LiteralPath $Path
  $summary = [ordered]@{
    exists = $true
    path = $Path
    length = $item.Length
    lastWriteTime = $item.LastWriteTime.ToString("o")
    tableExists = $null
    requestLogRowCount = $null
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if (-not $python) {
    $summary.queryStatus = "unavailable"
    $summary.queryError = "python_not_found"
    return $summary
  }

  $queryOutput = $null
  $queryError = $null
  try {
    $queryOutput = @'
import json
import sqlite3
import sys

path = sys.argv[1]
summary = {"tableExists": False, "requestLogRowCount": None}
conn = sqlite3.connect(path)
try:
    cursor = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='request_logs'")
    summary["tableExists"] = cursor.fetchone()[0] > 0
    if summary["tableExists"]:
        cursor = conn.execute("SELECT COUNT(*) FROM request_logs")
        summary["requestLogRowCount"] = cursor.fetchone()[0]
finally:
    conn.close()

print(json.dumps(summary))
'@ | & $python.Source - $Path 2>&1
  } catch {
    $queryError = $_.Exception.Message
  }

  if ($queryError) {
    $summary.queryStatus = "error"
    $summary.queryError = $queryError
    return $summary
  }

  try {
    $parsed = (($queryOutput | Out-String).Trim() | ConvertFrom-Json)
    $summary.queryStatus = "ok"
    $summary.tableExists = [bool]$parsed.tableExists
    if ($null -ne $parsed.requestLogRowCount) {
      $summary.requestLogRowCount = [int]$parsed.requestLogRowCount
    }
  } catch {
    $summary.queryStatus = "error"
    $summary.queryError = ConvertTo-LocalHardenedApiRedactedText (($queryOutput | Out-String).Trim())
  }

  $summary
}

function Get-LocalHardenedApiFailureForensics {
  param(
    [AllowNull()][string]$DataRoot,
    [AllowNull()][string]$StdoutPath,
    [AllowNull()][string]$StderrPath
  )

  $sqlitePath = if ($DataRoot) { Join-Path $DataRoot "codex_local_access_logs.sqlite" } else { $null }
  $healthPath = if ($DataRoot) { Join-Path $DataRoot "codex_local_access_health.json" } else { $null }
  $auditPath = if ($DataRoot) { Join-Path $DataRoot "codex_local_access_audit.jsonl" } else { $null }

  [ordered]@{
    dataRoot = Get-LocalHardenedApiDataRootInventory -Path $DataRoot
    sqlite = Get-LocalHardenedApiSqliteSummary -Path $sqlitePath
    health = Get-LocalHardenedApiJsonSummary -Path $healthPath
    audit = Get-LocalHardenedApiAuditSummary -Path $auditPath
    gatewayStdout = Get-LocalHardenedApiTextFileSummary -Path $StdoutPath
    gatewayStderr = Get-LocalHardenedApiTextFileSummary -Path $StderrPath
  }
}
