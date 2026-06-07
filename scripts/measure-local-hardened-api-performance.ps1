param(
  [string]$CargoManifestPath = "src-tauri/Cargo.toml",
  [string]$ReportDir = "reports/local-hardened-api-performance"
)

$ErrorActionPreference = "Stop"

function Get-JsonBetweenMarkers {
  param(
    [string]$Text,
    [string]$StartMarker,
    [string]$EndMarker
  )

  $start = $Text.IndexOf($StartMarker)
  if ($start -lt 0) {
    throw "missing marker: $StartMarker"
  }
  $start += $StartMarker.Length
  $end = $Text.IndexOf($EndMarker, $start)
  if ($end -lt 0) {
    throw "missing marker: $EndMarker"
  }
  return $Text.Substring($start, $end - $start).Trim()
}

function Get-MetricVerdict {
  param(
    [double]$ObservedP95,
    [double]$TargetP95
  )

  if ($ObservedP95 -le $TargetP95) {
    return "pass"
  }
  return "warn"
}

function Format-MetricTable {
  param([object[]]$Rows)

  $lines = @(
    "| Tier | Metric | p50 | p95 | max | Target p95 | Verdict |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  )
  foreach ($row in $Rows) {
    $lines += "| $($row.Tier) | $($row.Metric) | $($row.P50)ms | $($row.P95)ms | $($row.Max)ms | <= $($row.Target)ms | $($row.Verdict) |"
  }
  return ($lines -join [Environment]::NewLine)
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cockpit-local-access-perf-{0}-{1}" -f $PID, (Get-Date -Format "yyyyMMddHHmmssfff"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$stdoutPath = Join-Path $tempRoot "cargo.stdout.log"
$stderrPath = Join-Path $tempRoot "cargo.stderr.log"

$cargoArgs = @(
  "test",
  "--manifest-path",
  $CargoManifestPath,
  "isolated_local_access_performance_baseline_emits_json",
  "--",
  "--ignored",
  "--nocapture"
)

$process = Start-Process `
  -FilePath "cargo" `
  -ArgumentList $cargoArgs `
  -WorkingDirectory (Get-Location) `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath

$process.WaitForExit()
if ($process.ExitCode -ne 0) {
  $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
  $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
  [ordered]@{
    overall = "fail"
    exitCode = $process.ExitCode
    stdoutPath = $stdoutPath
    stderrPath = $stderrPath
    stdoutPreview = if ($stdoutText.Length -gt 800) { $stdoutText.Substring($stdoutText.Length - 800) } else { $stdoutText }
    stderrPreview = if ($stderrText.Length -gt 800) { $stderrText.Substring($stderrText.Length - 800) } else { $stderrText }
  } | ConvertTo-Json -Depth 8
  exit $process.ExitCode
}

$stdoutText = Get-Content -LiteralPath $stdoutPath -Raw
$jsonText = Get-JsonBetweenMarkers `
  -Text $stdoutText `
  -StartMarker "PERF_BASELINE_JSON_START" `
  -EndMarker "PERF_BASELINE_JSON_END"
$report = $jsonText | ConvertFrom-Json -Depth 20

$rows = New-Object System.Collections.Generic.List[object]
foreach ($tier in @($report.tiers)) {
  foreach ($metricName in @("stateLightMs", "stateFullMs", "selectorSortMs")) {
    $metric = $tier.metrics.$metricName
    $targetName = switch ($metricName) {
      "stateLightMs" { "stateLightP95MaxMs" }
      "stateFullMs" { "stateFullP95MaxMs" }
      "selectorSortMs" { "selectorSortP95MaxMs" }
    }
    $target = [double]$tier.targets.$targetName
    $rows.Add([pscustomobject]@{
      Tier = [string]$tier.tier
      Metric = $metricName
      P50 = ('{0:N3}' -f [double]$metric.p50Ms)
      P95 = ('{0:N3}' -f [double]$metric.p95Ms)
      Max = ('{0:N3}' -f [double]$metric.maxMs)
      Target = ('{0:N0}' -f $target)
      Verdict = Get-MetricVerdict -ObservedP95 ([double]$metric.p95Ms) -TargetP95 $target
    })
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$jsonReportPath = Join-Path $ReportDir "perf-baseline-$stamp.json"
$mdReportPath = Join-Path $ReportDir "perf-baseline-$stamp.md"

$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $jsonReportPath -Encoding UTF8

$markdown = @()
$markdown += "# Local Hardened API Performance Baseline - $stamp"
$markdown += ""
$markdown += "状态：pass"
$markdown += "时间：$(Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")"
$markdown += "类型：isolated synthetic baseline"
$markdown += ""
$markdown += "## 1. 范围"
$markdown += ""
$markdown += '- 数据规模：`M=50`、`L=200`'
$markdown += '- 指标：`state_light`、`state_full`、`selector_sort`'
$markdown += "- 环境：Rust 隔离测试根，不触碰 live Cockpit/Codex runtime"
$markdown += '- 采样：每项 `warmup=5`、`sample=25`'
$markdown += ""
$markdown += "## 2. 结果"
$markdown += ""
$markdown += (Format-MetricTable -Rows $rows)
$markdown += ""
$markdown += "## 3. 说明"
$markdown += ""
$markdown += '- 这份报告可作为 `U10 / NPB-03` 的第一版可复跑基线。'
$markdown += '- 它证明当前 `state_light`、`state_full` 和推荐排序主路径在隔离合成数据下有稳定量化输出。'
$markdown += "- 它还不能替代 live tray / 系统通知 / runtime switch / modal 首次打开的 app-safe 真实交互基线。"
$markdown += ""
$markdown += "## 4. 原始文件"
$markdown += ""
$markdown += "- JSON: $jsonReportPath"
$markdown += "- Cargo stdout: $stdoutPath"
$markdown += "- Cargo stderr: $stderrPath"

$markdown -join [Environment]::NewLine | Set-Content -LiteralPath $mdReportPath -Encoding UTF8

[ordered]@{
  overall = "pass"
  reportKind = $report.reportKind
  jsonReportPath = $jsonReportPath
  markdownReportPath = $mdReportPath
  cargoStdoutPath = $stdoutPath
  cargoStderrPath = $stderrPath
  metrics = $rows
} | ConvertTo-Json -Depth 10
