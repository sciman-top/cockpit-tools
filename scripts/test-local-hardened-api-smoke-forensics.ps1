param()

$ErrorActionPreference = "Stop"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)
  if ($Actual -ne $Expected) {
    throw ("{0}: expected [{1}], actual [{2}]" -f $Message, $Expected, $Actual)
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$helperPath = Join-Path $PSScriptRoot "local-hardened-api-smoke-forensics.ps1"
. $helperPath

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cockpit-hla-forensics-test-" + [System.Guid]::NewGuid().ToString("N"))
$stdoutPath = Join-Path $tempRoot "gateway.stdout.log"
$stderrPath = Join-Path $tempRoot "gateway.stderr.log"
$sqlitePath = Join-Path $tempRoot "codex_local_access_logs.sqlite"
$healthPath = Join-Path $tempRoot "codex_local_access_health.json"
$auditPath = Join-Path $tempRoot "codex_local_access_audit.jsonl"
$listener = $null

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
  @'
import sqlite3
import sys

path = sys.argv[1]
conn = sqlite3.connect(path)
try:
    conn.execute("CREATE TABLE request_logs(id INTEGER PRIMARY KEY, request_id TEXT NOT NULL)")
    conn.execute("INSERT INTO request_logs(request_id) VALUES ('req_1')")
    conn.execute("INSERT INTO request_logs(request_id) VALUES ('req_2')")
    conn.commit()
finally:
    conn.close()
'@ | python - $sqlitePath

  @'
{
  "schemaVersion": 1,
  "accounts": {
    "account-alpha": {
      "status": "healthy"
    }
  }
}
'@ | Set-Content -LiteralPath $healthPath -Encoding UTF8

  @'
{"phase":"select_account","status":200,"accountHash":"sha256:111111111111"}
{"phase":"proxy_response","status":502,"errorType":"upstream_disconnect","accountHash":"sha256:111111111111"}
'@ | Set-Content -LiteralPath $auditPath -Encoding UTF8

  @'
gateway started
authorization: Bearer sk-secret-token
operator: tester@example.com
'@ | Set-Content -LiteralPath $stdoutPath -Encoding UTF8

  "upstream transport failed`ntrace=socket reset" | Set-Content -LiteralPath $stderrPath -Encoding UTF8

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $listenerPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port

  $summary = Get-LocalHardenedApiFailureForensics -DataRoot $tempRoot -StdoutPath $stdoutPath -StderrPath $stderrPath -Port $listenerPort

  Assert-True ($summary.dataRoot.exists) "data root inventory should exist"
  Assert-True ($summary.dataRoot.fileCount -ge 3) "data root inventory should list probe files"
  Assert-True (@($summary.dataRoot.files | Where-Object { $_.name -eq "codex_local_access_logs.sqlite" }).Count -eq 1) "data root inventory should include sqlite file"
  Assert-True ($summary.sqlite.exists) "sqlite summary should exist"
  Assert-Equal $summary.sqlite.requestLogRowCount 2 "sqlite request log row count should be captured"
  Assert-Equal $summary.sqlite.tableExists $true "sqlite request_logs table should be detected"
  Assert-Equal $summary.health.exists $true "health summary should exist"
  Assert-Equal $summary.audit.exists $true "audit summary should exist"
  Assert-Equal $summary.audit.attemptedAccountCount 1 "audit summary should capture attempted account count"
  Assert-Equal $summary.gatewayStdout.exists $true "stdout summary should exist"
  Assert-Equal $summary.gatewayStderr.exists $true "stderr summary should exist"
  Assert-True ($summary.gatewayStdout.tailPreview -match "\[redacted-api-key\]") "stdout preview should redact API keys"
  Assert-True ($summary.gatewayStdout.tailPreview -match "\[redacted-email\]") "stdout preview should redact email addresses"
  Assert-True ($summary.gatewayStderr.tailPreview -match "socket reset") "stderr preview should capture tail text"
  Assert-Equal $summary.listener.exists $true "listener summary should exist"
  Assert-Equal $summary.listener.localPort $listenerPort "listener summary should capture bound port"
  Assert-True ([string]::IsNullOrWhiteSpace([string]$summary.listener.processName) -eq $false) "listener summary should capture process name"
} finally {
  if ($listener) {
    $listener.Stop()
  }
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

"PASS local hardened API smoke forensics tests"
