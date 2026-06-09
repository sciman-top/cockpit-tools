param(
  [string]$BaseUrl = "http://35.213.82.91:8003/v1",
  [string]$ProxyUrl = "http://127.0.0.1:10808",
  [string]$HostMatch = "35.213.82.91",
  [string]$PathPrefix = "/v1/responses",
  [string]$Model = "gpt-5.5",
  [string]$ApiKeyAccountPath = "C:\Users\sciman\.antigravity_cockpit\codex_accounts\codex_apikey_8b8853f15e823dc53bd156163035bc78.json",
  [int]$RequestTimeoutSeconds = 75,
  [switch]$KeepTemp
)

$ErrorActionPreference = "Stop"

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Wait-ForHttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 30,
    [string]$AuthorizationHeader
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $curlArgs = @("-sS", "-o", "NUL", "-w", "%{http_code}", "--max-time", "5")
      if ($AuthorizationHeader) {
        $curlArgs += @("-H", $AuthorizationHeader)
      }
      $curlArgs += $Url
      $statusText = (& curl.exe @curlArgs 2>$null).Trim()
      $statusCode = 0
      if ([int]::TryParse($statusText, [ref]$statusCode) -and $statusCode -ge 200 -and $statusCode -lt 500) {
        return $true
      }
    } catch {
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-ApiKeyFromAccount {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "API key account file not found: $Path"
  }
  $account = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  $apiKey = [string]$account.openai_api_key
  if (-not $apiKey) {
    throw "Account file does not contain openai_api_key: $Path"
  }
  return $apiKey
}

function Stop-ProcessTree {
  param([System.Diagnostics.Process]$Process)
  if ($null -eq $Process) {
    return
  }
  try {
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sidecarRoot = Join-Path $repoRoot "sidecars\cockpit-cliproxy\cdk\CLIProxyAPI"
$sidecarExe = Join-Path $env:TEMP ("cliproxyapi-verify-{0}.exe" -f $PID)
$tempRoot = Join-Path $env:TEMP ("cockpit-transport-bypass-{0}-{1}" -f $PID, (Get-Date -Format "yyyyMMddHHmmss"))
$null = New-Item -ItemType Directory -Force -Path $tempRoot
$port = Get-FreeTcpPort
$apiKey = Get-ApiKeyFromAccount -Path $ApiKeyAccountPath
$configPath = Join-Path $tempRoot "config.yaml"
$stdoutPath = Join-Path $tempRoot "sidecar.stdout.log"
$stderrPath = Join-Path $tempRoot "sidecar.stderr.log"
$logsDir = Join-Path $tempRoot "logs"
$requestBodyPath = Join-Path $tempRoot "request.json"
$authDir = Join-Path $tempRoot "auth"
$actualLogDir = Join-Path $authDir "logs"
$authDirYaml = ($authDir -replace '\\', '/')

$configYaml = @"
host: "127.0.0.1"
port: $port
auth-dir: "$authDirYaml"
api-keys:
  - "test-sidecar-client-key"
request-log: true
logging-to-file: true
proxy-url: "$ProxyUrl"
transport-bypass:
  - host: "$HostMatch"
    path-prefix: "$PathPrefix"
    sse-only: true
    action: "direct"
codex-api-key:
  - api-key: "$apiKey"
    base-url: "$BaseUrl"
    websockets: false
"@

$requestBody = @"
{
  "model": "$Model",
  "stream": true,
  "input": "Reply with exactly OK"
}
"@

Set-Content -LiteralPath $configPath -Value $configYaml -Encoding UTF8
Set-Content -LiteralPath $requestBodyPath -Value $requestBody -Encoding UTF8

$build = $null
$process = $null
$curlOutputPath = Join-Path $tempRoot "curl-output.txt"
$curlHeadersPath = Join-Path $tempRoot "curl-headers.txt"

try {
  $build = Start-Process -FilePath "go" `
    -ArgumentList @("build", "-o", $sidecarExe, ".\cmd\server") `
    -WorkingDirectory $sidecarRoot `
    -NoNewWindow `
    -PassThru `
    -Wait
  if ($build.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $sidecarExe)) {
    throw "failed to build temporary CLIProxyAPI server executable"
  }

  $process = Start-Process -FilePath $sidecarExe `
    -ArgumentList @("-config", $configPath) `
    -WorkingDirectory $sidecarRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  if (-not (Wait-ForHttpReady -Url ("http://127.0.0.1:{0}/v1/models" -f $port) -TimeoutSeconds 30 -AuthorizationHeader "Authorization: Bearer test-sidecar-client-key")) {
    throw "temporary sidecar did not become ready in time"
  }

  $requestStartTime = Get-Date
  $curlArgs = @(
    "-sS",
    "-N",
    "--max-time", [string]$RequestTimeoutSeconds,
    "-D", $curlHeadersPath,
    "-H", "Authorization: Bearer test-sidecar-client-key",
    "-H", "Content-Type: application/json",
    "-H", "Accept: text/event-stream",
    "--data-binary", "@$requestBodyPath",
    ("http://127.0.0.1:{0}/v1/responses" -f $port)
  )
  $curlText = & curl.exe @curlArgs 2>&1
  $curlText | Set-Content -LiteralPath $curlOutputPath -Encoding UTF8
  $curlExitCode = $LASTEXITCODE

  $requestId = $null
  if (Test-Path -LiteralPath $curlHeadersPath) {
    $requestId = Select-String -Path $curlHeadersPath -Pattern '^X-Request-Id:\s*(.+)$' | Select-Object -First 1 | ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() }
  }

  $logPath = $null
  if ($requestId) {
    $candidate = Get-ChildItem -LiteralPath $actualLogDir -Filter "*-$requestId.log" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) {
      $logPath = $candidate.FullName
    }
  }
  if (-not $logPath -and (Test-Path -LiteralPath $actualLogDir)) {
    $candidate = Get-ChildItem -LiteralPath $actualLogDir -Filter "v1-responses-*.log" -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -ge $requestStartTime.AddSeconds(-5) } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) {
      $logPath = $candidate.FullName
    }
  }

  $logContent = $null
  if ($logPath -and (Test-Path -LiteralPath $logPath)) {
    $logContent = Get-Content -LiteralPath $logPath -Raw
  }

  $transportEvents = @()
  if ($logContent) {
    $transportEvents = @(Select-String -InputObject $logContent -Pattern 'Transport: .*' -AllMatches | ForEach-Object { $_.Matches.Value })
  }

  $completedSeen = $false
  $completedSeen = [bool]((Get-Content -LiteralPath $curlOutputPath -Raw) -match 'response\.completed')

  $attemptSeen = [bool]($transportEvents | Where-Object { $_ -match 'action=direct_bypass_attempt' })
  $successSeen = [bool]($transportEvents | Where-Object { $_ -match 'action=direct_bypass_success' })
  $fallbackSeen = [bool]($transportEvents | Where-Object { $_ -match 'action=direct_bypass_failed_fallback_proxy' })

  $stdoutTail = if (Test-Path -LiteralPath $stdoutPath) { (Get-Content -LiteralPath $stdoutPath -Tail 80) -join "`n" } else { $null }
  $stderrTail = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Tail 80) -join "`n" } else { $null }

  [ordered]@{
    overall = if ($attemptSeen) { "pass" } else { "fail" }
    baseUrl = $BaseUrl
    proxyUrl = $ProxyUrl
    hostMatch = $HostMatch
    pathPrefix = $PathPrefix
    requestId = $requestId
    curlExitCode = $curlExitCode
    responseCompletedSeen = $completedSeen
    directBypassAttemptSeen = $attemptSeen
    directBypassSuccessSeen = $successSeen
    directBypassFallbackSeen = $fallbackSeen
    requestLogPath = $logPath
    actualLogDir = $actualLogDir
    curlHeadersPath = $curlHeadersPath
    curlOutputPath = $curlOutputPath
    stdoutPath = $stdoutPath
    stderrPath = $stderrPath
    transportEvents = $transportEvents
    stdoutTail = $stdoutTail
    stderrTail = $stderrTail
  } | ConvertTo-Json -Depth 8
}
finally {
  Stop-ProcessTree -Process $process
  if (-not $KeepTemp) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sidecarExe -Force -ErrorAction SilentlyContinue
  }
}
