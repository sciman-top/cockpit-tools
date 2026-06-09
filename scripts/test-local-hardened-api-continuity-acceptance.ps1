param(
  [switch]$KeepTemp
)

$ErrorActionPreference = "Stop"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Equal {
  param([object]$Actual, [object]$Expected, [string]$Message)
  if ($Actual -ne $Expected) {
    throw "$Message; expected=[$Expected], actual=[$Actual]"
  }
}

function Convert-JsonOutput {
  param([object[]]$Output, [string]$Context)
  $text = ($Output | Out-String).Trim()
  if (-not $text) {
    throw "$Context did not emit JSON"
  }
  $text | ConvertFrom-Json
}

function Get-ResultByName {
  param([object]$Report, [string]$Name)
  $result = @($Report.results | Where-Object { $_.name -eq $Name } | Select-Object -First 1)
  if (-not $result) {
    throw "missing result $Name"
  }
  $result
}

function Write-AuditLines {
  param([string]$Path, [object[]]$Events)
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $Events |
    ForEach-Object { $_ | ConvertTo-Json -Depth 10 -Compress } |
    Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$acceptScript = Join-Path $PSScriptRoot "accept-local-hardened-api-continuity.ps1"
$smokeScript = Join-Path $PSScriptRoot "smoke-local-hardened-api.ps1"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cockpit-hla-accept-test-{0}-{1}" -f $PID, (Get-Date -Format "yyyyMMddHHmmssfff"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
  $fakeSmoke = Join-Path $tempRoot "fake-smoke.ps1"
  $argsPath = Join-Path $tempRoot "smoke-args.json"
  $reportPath = Join-Path $tempRoot "fake-report.json"
  @"
param(
  [Parameter(ValueFromRemainingArguments = `$true)]
  [string[]]`$Remaining
)
`$Remaining | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$argsPath" -Encoding UTF8
`$drainRequested = `$Remaining -contains "-AutoDrainFirstFreeAccountUntilFallback"
`$report = [ordered]@{
  overall = "pass"
  reportPath = "$reportPath"
  results = @(
    [ordered]@{ name = "same_task_affinity_fallback_blocked"; status = "pass"; evidence = [ordered]@{ has429 = `$true; sameTaskAffinityLocalCompletionCount = 1 } },
    [ordered]@{ name = "quota_drain_until_hard_affinity_block"; status = if (`$drainRequested) { "pass" } else { "skipped" }; evidence = [ordered]@{ requested = `$drainRequested } },
    [ordered]@{ name = "codex_exec_task_e2e"; status = "pass"; evidence = [ordered]@{ taskFileHasMarker = `$true } },
    [ordered]@{ name = "codex_cli_config_auth_untouched"; status = "pass"; evidence = [ordered]@{ unchanged = `$true } },
    [ordered]@{ name = "codex_app_process_stable"; status = "pass"; evidence = [ordered]@{ stable = `$true } }
  )
  autoDrainFirstFreeAccountUntilFallback = `$drainRequested
  temporaryFallbackConfig = [ordered]@{
    accountCount = 3
  }
}
`$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath "$reportPath" -Encoding UTF8
`$report | ConvertTo-Json -Depth 10
"@ | Set-Content -LiteralPath $fakeSmoke -Encoding UTF8

  $blockedOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $acceptScript `
    -SmokeScriptPath $fakeSmoke `
    -Model "gpt-5.5" `
    -SkipEphemeralGatewayBuild 2>$null

  Assert-True ($LASTEXITCODE -ne 0) "expected wrapper to block live upstream acceptance without acknowledgement"
  $blockedSummary = ($blockedOutput | Out-String) | ConvertFrom-Json
  Assert-Equal $blockedSummary.overall "blocked" "expected blocked summary without acknowledgement"
  Assert-Equal $blockedSummary.reason "live_upstream_risk_ack_required" "expected live upstream risk acknowledgement guard"
  Assert-Equal $blockedSummary.requiredSwitch "-AcknowledgeLiveUpstreamRisk" "expected required acknowledgement switch"
  Assert-True (-not (Test-Path -LiteralPath $argsPath)) "expected blocked wrapper not to invoke smoke script"

  $expandedBlockedOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $acceptScript `
    -SmokeScriptPath $fakeSmoke `
    -Model "gpt-5.5" `
    -DrainFirstFreeAccountUntilFallback `
    -DrainMaxRequests 31 `
    -AcknowledgeLiveUpstreamRisk `
    -SkipEphemeralGatewayBuild 2>$null

  Assert-True ($LASTEXITCODE -ne 0) "expected wrapper to block expanded drain attempts without expanded acknowledgement"
  $expandedBlockedSummary = ($expandedBlockedOutput | Out-String) | ConvertFrom-Json
  Assert-Equal $expandedBlockedSummary.overall "blocked" "expected expanded blocked summary"
  Assert-Equal $expandedBlockedSummary.reason "expanded_live_upstream_risk_ack_required" "expected expanded live upstream risk acknowledgement guard"
  Assert-Equal $expandedBlockedSummary.requiredSwitch "-AcknowledgeExpandedLiveUpstreamRisk" "expected expanded acknowledgement switch"
  Assert-True (-not (Test-Path -LiteralPath $argsPath)) "expected expanded blocked wrapper not to invoke smoke script"

  $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $acceptScript `
    -SmokeScriptPath $fakeSmoke `
    -Model "gpt-5.5" `
    -AcknowledgeLiveUpstreamRisk `
    -SkipEphemeralGatewayBuild 2>$null

  if ($LASTEXITCODE -ne 0) {
    throw "acceptance wrapper failed with exit_code=$LASTEXITCODE"
  }
  $summary = ($output | Out-String) | ConvertFrom-Json
  Assert-Equal $summary.overall "pass" "expected pass summary"
  Assert-Equal $summary.sameTaskAffinity "pass" "expected same-task affinity pass"
  Assert-Equal $summary.codexExec "pass" "expected codex exec pass"
  Assert-Equal $summary.cliUntouched "pass" "expected CLI guard pass"
  Assert-Equal $summary.appStable "pass" "expected App guard pass"
  Assert-Equal $summary.liveUpstreamRiskAcknowledged $true "expected live upstream risk acknowledgement summary"
  Assert-Equal $summary.expandedLiveUpstreamRiskAcknowledged $false "expected expanded acknowledgement off by default"
  Assert-Equal $summary.drainRequested $false "expected drain off by default"
  Assert-Equal $summary.drainResult "skipped" "expected drain result skipped by default"
  Assert-Equal $summary.configuredAccountCount 3 "expected configured account count summary"

  $args = Get-Content -LiteralPath $argsPath -Raw | ConvertFrom-Json
  foreach ($requiredArg in @(
      "-Stage",
      "fallback_probe",
      "-StartEphemeralGateway",
      "-TemporaryFallbackConfig",
      "-AppSafeIsolatedProbe",
      "-AcknowledgeLiveUpstreamRisk",
      "-RunUpstreamSmoke",
      "-RunCodexExecSmoke",
      "-RequireQuotaFallback",
      "-AssertCodexCliConfigUntouched",
      "-AssertCodexAppProcessStable",
      "-WriteReport"
  )) {
    Assert-True ([bool](@($args | Where-Object { $_ -eq $requiredArg }).Count)) "expected smoke arg $requiredArg"
  }

  $structuredTerminalRoot = Join-Path $tempRoot "structured-terminal-429-data"
  New-Item -ItemType Directory -Force -Path $structuredTerminalRoot | Out-Null
  [ordered]@{
    enabled = $true
    port = 1
    apiKey = "test-api-key"
    accountIds = @(
      "codex_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "codex_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    )
    safetyConfig = [ordered]@{
      schemaVersion = 1
      hardenedLocalMode = $true
      maxConcurrentRequests = 1
      minRequestIntervalSeconds = 20
      maxRetryAccounts = 2
      fallbackMode = "disabled"
    }
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $structuredTerminalRoot "codex_local_access.json") -Encoding UTF8
  Write-AuditLines (Join-Path $structuredTerminalRoot "codex_local_access_audit.jsonl") @(
    [ordered]@{ schemaVersion = 1; timestamp = 1; requestId = "req-a"; phase = "listener"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "-"; outcome = "accepted" },
    [ordered]@{ schemaVersion = 1; timestamp = 2; requestId = "req-a"; phase = "upstream_forward"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; outcome = "response_received" },
    [ordered]@{ schemaVersion = 1; timestamp = 3; requestId = "req-a"; phase = "quota_classification"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "failover"; detail = [ordered]@{ provider_code = "usage_limit_reached" } },
    [ordered]@{ schemaVersion = 1; timestamp = 4; requestId = "req-a"; phase = "model_cooldown_applied"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "recorded" },
    [ordered]@{ schemaVersion = 1; timestamp = 5; requestId = "req-a"; phase = "fallback_blocked"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "hard_affinity" },
    [ordered]@{ schemaVersion = 1; timestamp = 6; requestId = "req-a"; phase = "final_response"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "error" },
    [ordered]@{ schemaVersion = 1; timestamp = 7; requestId = "req-b"; phase = "listener"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "-"; outcome = "accepted" },
    [ordered]@{ schemaVersion = 1; timestamp = 8; requestId = "req-b"; phase = "upstream_forward"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:healthy-b"; status = 200; outcome = "response_received" },
    [ordered]@{ schemaVersion = 1; timestamp = 9; requestId = "req-b"; phase = "stream_completed"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:healthy-b"; outcome = "completed" }
  )
  $structuredTerminalOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $smokeScript `
    -Stage fallback_probe `
    -DataRoot $structuredTerminalRoot `
    -BaseUrl "http://127.0.0.1:1/v1" `
    -ApiKey "test-api-key" `
    -RequireQuotaFallback 2>$null

  $structuredTerminalReport = Convert-JsonOutput $structuredTerminalOutput "structured terminal 429 smoke fixture"
  $structuredTerminalSameTask = Get-ResultByName $structuredTerminalReport "same_task_affinity_fallback_blocked"
  Assert-Equal $structuredTerminalSameTask.status "pass" "structured usage_limit_reached terminal 429 should satisfy same-task hard-affinity guard"
  Assert-Equal $structuredTerminalSameTask.evidence.sameTaskAffinityStructuredQuotaTerminal429Count 1 "expected structured terminal 429 count"
  Assert-Equal $structuredTerminalSameTask.evidence.sameTaskAffinityUnstructuredTerminal429Count 0 "expected no unstructured terminal 429"
  Assert-Equal $structuredTerminalSameTask.evidence.continuationRequestCount 0 "fixture without request_trace continuation should report zero continuation requests"
  Assert-Equal $structuredTerminalReport.continuitySummary.sameTaskAffinityFallbackBlocked.evidence.sameTaskAffinityStructuredQuotaTerminal429Count 1 "expected continuity summary to expose structured terminal 429 count"

  $unstructuredTerminalRoot = Join-Path $tempRoot "unstructured-terminal-429-data"
  New-Item -ItemType Directory -Force -Path $unstructuredTerminalRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $structuredTerminalRoot "codex_local_access.json") -Destination (Join-Path $unstructuredTerminalRoot "codex_local_access.json") -Force
  Write-AuditLines (Join-Path $unstructuredTerminalRoot "codex_local_access_audit.jsonl") @(
    [ordered]@{ schemaVersion = 1; timestamp = 1; requestId = "req-a"; phase = "quota_classification"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "failover"; detail = [ordered]@{ provider_code = "usage_limit_reached" } },
    [ordered]@{ schemaVersion = 1; timestamp = 2; requestId = "req-a"; phase = "model_cooldown_applied"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "recorded" },
    [ordered]@{ schemaVersion = 1; timestamp = 3; requestId = "req-a"; phase = "fallback_blocked"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "hard_affinity" },
    [ordered]@{ schemaVersion = 1; timestamp = 4; requestId = "req-a"; phase = "final_response"; route = "/v1/responses"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; outcome = "error" }
  )
  $unstructuredTerminalOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $smokeScript `
    -Stage fallback_probe `
    -DataRoot $unstructuredTerminalRoot `
    -BaseUrl "http://127.0.0.1:1/v1" `
    -ApiKey "test-api-key" `
    -RequireQuotaFallback 2>$null

  $unstructuredTerminalReport = Convert-JsonOutput $unstructuredTerminalOutput "unstructured terminal 429 smoke fixture"
  $unstructuredTerminalSameTask = Get-ResultByName $unstructuredTerminalReport "same_task_affinity_fallback_blocked"
  Assert-Equal $unstructuredTerminalSameTask.status "fail" "unstructured terminal 429 should still fail same-task hard-affinity guard"
  Assert-Equal $unstructuredTerminalSameTask.evidence.sameTaskAffinityUnstructuredTerminal429Count 1 "expected unstructured terminal 429 count"

  $historyNoiseRoot = Join-Path $tempRoot "history-noise-data"
  New-Item -ItemType Directory -Force -Path $historyNoiseRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $structuredTerminalRoot "codex_local_access.json") -Destination (Join-Path $historyNoiseRoot "codex_local_access.json") -Force
  $historyNoiseEvents = @(
    [ordered]@{ schemaVersion = 1; timestamp = 1; requestId = "req-a"; phase = "listener"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "-"; outcome = "accepted" },
    [ordered]@{ schemaVersion = 1; timestamp = 2; requestId = "req-a"; phase = "routing_decision"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; outcome = "selected"; detail = [ordered]@{ selected_reason = "primary_candidate"; request_id_source = "gateway_request_id" } },
    [ordered]@{ schemaVersion = 1; timestamp = 3; requestId = "req-a"; phase = "upstream_forward"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; outcome = "response_received" },
    [ordered]@{ schemaVersion = 1; timestamp = 4; requestId = "req-a"; phase = "quota_classification"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "failover"; detail = [ordered]@{ provider_code = "usage_limit_reached" } },
    [ordered]@{ schemaVersion = 1; timestamp = 5; requestId = "req-a"; phase = "model_cooldown_applied"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "recorded" },
    [ordered]@{ schemaVersion = 1; timestamp = 6; requestId = "req-a"; phase = "fallback_selected"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:exhausted-a"; status = 429; errorType = "usage_limit_reached"; outcome = "selected" },
    [ordered]@{ schemaVersion = 1; timestamp = 7; requestId = "req-a"; phase = "routing_decision"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:healthy-b"; outcome = "selected"; detail = [ordered]@{ selected_reason = "fallback_candidate"; request_id_source = "gateway_request_id" } },
    [ordered]@{ schemaVersion = 1; timestamp = 8; requestId = "req-a"; phase = "final_response"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:healthy-b"; status = 200; outcome = "completed" }
  )
  for ($i = 0; $i -lt 130; $i++) {
    $timestamp = 100 + ($i * 2)
    $historyNoiseEvents += [ordered]@{ schemaVersion = 1; timestamp = $timestamp; requestId = "req-noise-$i"; phase = "routing_decision"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:healthy-b"; outcome = "selected"; detail = [ordered]@{ selected_reason = "healthy_candidate"; request_id_source = "gateway_request_id" } }
    $historyNoiseEvents += [ordered]@{ schemaVersion = 1; timestamp = $timestamp + 1; requestId = "req-noise-$i"; phase = "final_response"; route = "/v1/chat/completions"; model = "gpt-5.5"; accountHash = "sha256:healthy-b"; status = 400; errorType = "unknown"; outcome = "error" }
  }
  Write-AuditLines (Join-Path $historyNoiseRoot "codex_local_access_audit.jsonl") $historyNoiseEvents
  $historyNoiseOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $smokeScript `
    -Stage fallback_probe `
    -DataRoot $historyNoiseRoot `
    -BaseUrl "http://127.0.0.1:1/v1" `
    -ApiKey "test-api-key" `
    -RequireQuotaFallback 2>$null

  $historyNoiseReport = Convert-JsonOutput $historyNoiseOutput "history noise smoke fixture"
  $historyNoiseSameTask = Get-ResultByName $historyNoiseReport "same_task_affinity_fallback_blocked"
  Assert-Equal $historyNoiseSameTask.evidence.has429 $true "early usage-limit 429 should survive audit summarization even when later noise exceeds tail window"
  Assert-Equal $historyNoiseSameTask.evidence.hasModelCooldownApplied $true "model cooldown evidence should survive audit summarization"
  Assert-Equal $historyNoiseSameTask.evidence.hasFallbackSelected $true "fallback_selected evidence should survive audit summarization"
  Assert-Equal $historyNoiseSameTask.evidence.selectedAccountCount 2 "selected account summary should keep both exhausted and fallback accounts"
  Assert-True ($historyNoiseSameTask.evidence.tailEventCount -gt 120) "audit evidence should no longer be limited to the last 120 events"

  $responsesServerRoot = Join-Path $tempRoot "responses-sse-server"
  New-Item -ItemType Directory -Force -Path $responsesServerRoot | Out-Null
  $responsesServerScript = Join-Path $responsesServerRoot "server.js"
  $responsesServerLog = Join-Path $responsesServerRoot "requests.jsonl"
  $responsesServerStdout = Join-Path $responsesServerRoot "stdout.log"
  $responsesServerStderr = Join-Path $responsesServerRoot "stderr.log"
  $responsesServerPort = Get-FreeTcpPort
  @"
const fs = require('fs');
const http = require('http');

const port = Number(process.env.TEST_PORT);
const logPath = process.env.LOG_PATH;
let responseSeq = 0;

function appendLog(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendSse(res, responseId, text) {
  const created = {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      created_at: 1,
      status: 'in_progress',
      model: 'gpt-5.4',
      output: []
    }
  };
  const textDone = {
    type: 'response.output_text.done',
    content_index: 0,
    item_id: 'msg-' + responseId,
    output_index: 0,
    text
  };
  const completed = {
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'gpt-5.4',
      output: []
    }
  };
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
  res.end(
    'event: response.created\ndata: ' + JSON.stringify(created) + '\n\n' +
    'event: response.output_text.done\ndata: ' + JSON.stringify(textDone) + '\n\n' +
    'event: response.completed\ndata: ' + JSON.stringify(completed) + '\n\n'
  );
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let parsedBody = null;
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch (_) {
        parsedBody = { parseError: true, rawBody };
      }
    }

    appendLog({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization || null,
      body: parsedBody
    });

    if (req.headers.authorization !== 'Bearer test-api-key') {
      sendJson(res, 401, { error: { message: 'invalid key' } });
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      sendJson(res, 200, { data: [{ id: 'gpt-5.4' }] });
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      sendJson(res, 200, { choices: [{ message: { content: 'OK' } }] });
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/responses') {
      responseSeq += 1;
      sendSse(res, 'resp-' + responseSeq, 'OK');
      return;
    }
    sendJson(res, 404, { error: { message: 'not found' } });
  });
});

server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
"@ | Set-Content -LiteralPath $responsesServerScript -Encoding UTF8
  $responsesServerProcess = Start-Process -FilePath node -ArgumentList @($responsesServerScript) -PassThru -WindowStyle Hidden -RedirectStandardOutput $responsesServerStdout -RedirectStandardError $responsesServerStderr -WorkingDirectory $responsesServerRoot -Environment @{
    TEST_PORT = [string]$responsesServerPort
    LOG_PATH = $responsesServerLog
  }
  try {
    Start-Sleep -Milliseconds 500
    $responsesDrainRoot = Join-Path $tempRoot "responses-drain-data"
    New-Item -ItemType Directory -Force -Path $responsesDrainRoot | Out-Null
    [ordered]@{
      enabled = $true
      port = 1
      apiKey = "test-api-key"
      accountIds = @("codex_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      safetyConfig = [ordered]@{
        schemaVersion = 1
        hardenedLocalMode = $true
        maxConcurrentRequests = 1
        minRequestIntervalSeconds = 20
        maxRetryAccounts = 2
        fallbackMode = "disabled"
      }
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $responsesDrainRoot "codex_local_access.json") -Encoding UTF8

    $responsesDrainOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $smokeScript `
      -Stage fallback_probe `
      -DataRoot $responsesDrainRoot `
      -BaseUrl ("http://127.0.0.1:{0}/v1" -f $responsesServerPort) `
      -ApiKey "test-api-key" `
      -RunUpstreamSmoke `
      -AcknowledgeLiveUpstreamRisk `
      -AcknowledgeExpandedLiveUpstreamRisk `
      -RequireQuotaFallback `
      -AutoDrainFirstFreeAccountUntilFallback `
      -AutoDrainMaxRequests 2 `
      -AutoDrainRequestIntervalSeconds 0 2>$null

    $responsesDrainReport = Convert-JsonOutput $responsesDrainOutput "responses continuation SSE fixture"
    $responsesDrainResult = Get-ResultByName $responsesDrainReport "responses_continuation_drain_until_hard_affinity_block"
    Assert-Equal $responsesDrainResult.status "blocked" "fixture without audit fallback should stop after bounded continuation attempts"
    Assert-Equal @($responsesDrainResult.evidence.attempts).Count 2 "expected two continuation attempts"
    Assert-Equal $responsesDrainResult.evidence.attempts[0].responseId "resp-1" "first SSE continuation response should expose response id"
    Assert-Equal $responsesDrainResult.evidence.attempts[0].previousResponseIdUsed $false "first attempt should not send previous_response_id"
    Assert-Equal $responsesDrainResult.evidence.attempts[1].previousResponseIdUsed $true "second attempt should reuse previous_response_id parsed from SSE"
    Assert-Equal $responsesDrainResult.evidence.attempts[1].responseId "resp-2" "second SSE continuation response should expose response id"

    $responsesServerRequests = Get-Content -LiteralPath $responsesServerLog | ForEach-Object { $_ | ConvertFrom-Json }
    $responsePosts = @($responsesServerRequests | Where-Object { $_.url -eq "/v1/responses" })
    Assert-Equal $responsePosts.Count 2 "expected two /v1/responses requests"
    Assert-Equal $responsePosts[0].body.stream $true "continuation drain should use stream=true for /v1/responses probe"
    Assert-Equal $responsePosts[0].body.input "Reply with exactly OK." "first /v1/responses request should use simple string input"
    Assert-Equal $responsePosts[0].body.store $false "first /v1/responses request should force store=false for Codex HTTP upstream compatibility"
    Assert-True (-not $responsePosts[0].body.previous_response_id) "first /v1/responses request should not include previous_response_id"
    Assert-Equal $responsePosts[1].body.stream $true "follow-up /v1/responses request should keep stream=true"
    Assert-Equal $responsePosts[1].body.input "Continue the same task and reply with exactly OK." "second /v1/responses request should preserve continuation prompt"
    Assert-Equal $responsePosts[1].body.store $false "second /v1/responses request should keep store=false on continuation"
    Assert-Equal $responsePosts[1].body.previous_response_id "resp-1" "second /v1/responses request should include previous_response_id from first SSE response"
  } finally {
    if ($responsesServerProcess -and -not $responsesServerProcess.HasExited) {
      Stop-Process -Id $responsesServerProcess.Id -Force
    }
  }

  $drainOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $acceptScript `
    -SmokeScriptPath $fakeSmoke `
    -Model "gpt-5.5" `
    -AcknowledgeLiveUpstreamRisk `
    -AcknowledgeExpandedLiveUpstreamRisk `
    -DrainFirstFreeAccountUntilFallback `
    -DrainMaxRequests 3 `
    -DrainRequestIntervalSeconds 0 `
    -SkipEphemeralGatewayBuild 2>$null

  if ($LASTEXITCODE -ne 0) {
    throw "drain acceptance wrapper failed with exit_code=$LASTEXITCODE"
  }
  $drainSummary = ($drainOutput | Out-String) | ConvertFrom-Json
  Assert-Equal $drainSummary.drainRequested $true "expected drain summary requested"
  Assert-Equal $drainSummary.drainResult "pass" "expected drain result pass"
  Assert-Equal $drainSummary.expandedLiveUpstreamRiskAcknowledged $true "expected drain expanded acknowledgement summary"
  $drainArgs = Get-Content -LiteralPath $argsPath -Raw | ConvertFrom-Json
  foreach ($requiredDrainArg in @(
      "-AcknowledgeExpandedLiveUpstreamRisk",
      "-AutoDrainFirstFreeAccountUntilFallback",
      "-AutoDrainMaxRequests",
      "3",
      "-AutoDrainRequestIntervalSeconds",
      "0"
  )) {
    Assert-True ([bool](@($drainArgs | Where-Object { $_ -eq $requiredDrainArg }).Count)) "expected drain smoke arg $requiredDrainArg"
  }

  $singleAccountRoot = Join-Path $tempRoot "single-account-data"
  New-Item -ItemType Directory -Force -Path $singleAccountRoot | Out-Null
  [ordered]@{
    enabled = $true
    port = 1
    apiKey = "test-api-key"
    accountIds = @("codex_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    safetyConfig = [ordered]@{
      schemaVersion = 1
      hardenedLocalMode = $true
      maxConcurrentRequests = 1
      minRequestIntervalSeconds = 20
      maxRetryAccounts = 2
      fallbackMode = "disabled"
    }
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $singleAccountRoot "codex_local_access.json") -Encoding UTF8

  $contractOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $smokeScript `
    -Stage fallback_probe `
    -DataRoot $singleAccountRoot `
    -BaseUrl "http://127.0.0.1:1/v1" `
    -ApiKey "test-api-key" `
    -RunUpstreamSmoke `
    -AcknowledgeLiveUpstreamRisk 2>$null

  $contractReport = Convert-JsonOutput $contractOutput "single-account fallback_probe contract"
  $contractResult = Get-ResultByName $contractReport "config_fallback_probe_contract"
  Assert-Equal $contractResult.status "pass" "fallback_probe config contract should allow a one-account API service pool"
  Assert-Equal $contractResult.evidence.accountCount 1 "expected one-account fallback_probe evidence"
  Assert-Equal $contractResult.evidence.gatewayMode "legacy" "fallback_probe temporary config should force legacy gateway mode for Rust continuity audit"

  $largePoolRoot = Join-Path $tempRoot "large-pool-data"
  New-Item -ItemType Directory -Force -Path $largePoolRoot | Out-Null
  [ordered]@{
    enabled = $true
    port = 1
    apiKey = "test-api-key"
    accountIds = @(
      "codex_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "codex_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "codex_cccccccccccccccccccccccccccccccc",
      "codex_dddddddddddddddddddddddddddddddd",
      "codex_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "codex_ffffffffffffffffffffffffffffffff",
      "codex_11111111111111111111111111111111",
      "codex_22222222222222222222222222222222",
      "codex_33333333333333333333333333333333",
      "codex_44444444444444444444444444444444",
      "codex_55555555555555555555555555555555",
      "codex_66666666666666666666666666666666",
      "codex_77777777777777777777777777777777"
    )
    safetyConfig = [ordered]@{
      schemaVersion = 1
      hardenedLocalMode = $true
      maxConcurrentRequests = 1
      minRequestIntervalSeconds = 20
      maxRetryAccounts = 2
      fallbackMode = "disabled"
    }
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $largePoolRoot "codex_local_access.json") -Encoding UTF8

  $largePoolContractOutput = & pwsh -NoProfile -ExecutionPolicy Bypass -File $smokeScript `
    -Stage fallback_probe `
    -DataRoot $largePoolRoot `
    -BaseUrl "http://127.0.0.1:1/v1" `
    -ApiKey "test-api-key" `
    -RunUpstreamSmoke `
    -AcknowledgeLiveUpstreamRisk 2>$null

  $largePoolContractReport = Convert-JsonOutput $largePoolContractOutput "large-pool fallback_probe contract"
  $largePoolContractResult = Get-ResultByName $largePoolContractReport "config_fallback_probe_contract"
  Assert-Equal $largePoolContractResult.status "pass" "fallback_probe config contract should allow a fully configured API service pool"
  Assert-Equal $largePoolContractResult.evidence.accountCount 13 "expected large-pool fallback_probe evidence"
  Assert-Equal $largePoolContractResult.evidence.gatewayMode "legacy" "fallback_probe contract evidence should default to legacy gateway mode"

  "PASS local hardened API continuity acceptance wrapper tests"
} finally {
  if (-not $KeepTemp -and (Test-Path -LiteralPath $tempRoot)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
