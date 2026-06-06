$ErrorActionPreference = "Stop"
$repoRoot = 'D:\CODE\external\Cockpit-Tools-Local'
$stopPids = @(29380)
$gracefulStopTimeoutSeconds = 8
$activeStreamAuditWindowMinutes = 720
$dataRoot = 'C:\Users\sciman\.antigravity_cockpit'
$eventLogPath = 'D:\CODE\external\Cockpit-Tools-Local\reports\cockpit-dev-watchdog\20260531-153520-final-debug-watchdog\debug-switch-runner-20260531-221127167.jsonl'

function Write-RunnerEvent {
  param([Parameter(Mandatory = $true)][hashtable]$Event)

  $Event.timestamp = (Get-Date).ToString("o")
  $json = $Event | ConvertTo-Json -Depth 8 -Compress
  Add-Content -LiteralPath $eventLogPath -Value $json -Encoding UTF8
}

function Get-ObjectPropertyValue {
  param($Object, [string]$Name)
  if ($null -eq $Object) {
    return $null
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) {
    return $property.Value
  }
  return $null
}

function Get-ActiveCodexLocalAccessStreamSnapshot {
  $activeLeases = @{}
  $auditPath = Join-Path $dataRoot "codex_local_access_audit.jsonl"
  $auditPaths = @("$auditPath.1", $auditPath) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
  $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $windowStartMs = $nowMs - ([int64]$activeStreamAuditWindowMinutes * 60 * 1000)
  $events = New-Object System.Collections.Generic.List[object]
  $sequence = 0
  $parseErrorCount = 0
  $lastEventTimestampMs = $null

  foreach ($path in $auditPaths) {
    try {
      foreach ($line in @(Get-Content -LiteralPath $path -Tail 4000 -ErrorAction Stop)) {
        if ([string]::IsNullOrWhiteSpace($line)) {
          continue
        }
        try {
          $event = $line | ConvertFrom-Json -ErrorAction Stop
        } catch {
          $parseErrorCount += 1
          continue
        }
        $timestamp = Get-ObjectPropertyValue $event "timestamp"
        if ($null -eq $timestamp) {
          continue
        }
        $timestamp = [int64]$timestamp
        if ($timestamp -lt $windowStartMs) {
          continue
        }
        $detail = Get-ObjectPropertyValue $event "detail"
        $phase = [string](Get-ObjectPropertyValue $event "phase")
        $leaseId = [string](Get-ObjectPropertyValue $detail "lease_id")
        $activeCount = $null
        $activeCountValue = Get-ObjectPropertyValue $detail "active_count"
        if ($null -ne $activeCountValue) {
          [int]$parsedActiveCount = 0
          if ([int]::TryParse([string]$activeCountValue, [ref]$parsedActiveCount)) {
            $activeCount = $parsedActiveCount
          }
        }

        $isLeaseEvent = $phase -eq "lease_granted" -or $phase -eq "lease_released"
        $isClearMarker = $null -ne $activeCount -and $activeCount -le 0
        if ((-not $isLeaseEvent -or [string]::IsNullOrWhiteSpace($leaseId)) -and -not $isClearMarker) {
          continue
        }
        $events.Add([pscustomobject][ordered]@{
            timestamp = $timestamp
            sequence = $sequence
            phase = $phase
            leaseId = $leaseId
            activeCount = $activeCount
            path = $path
          })
        $sequence += 1
      }
    } catch {
      $parseErrorCount += 1
    }
  }

  foreach ($event in @($events | Sort-Object timestamp, sequence)) {
    $lastEventTimestampMs = $event.timestamp
    if ($event.phase -eq "lease_granted") {
      $activeLeases[$event.leaseId] = $event
    } elseif ($event.phase -eq "lease_released") {
      [void]$activeLeases.Remove($event.leaseId)
    }
    if ($null -ne $event.activeCount -and [int]$event.activeCount -le 0) {
      $activeLeases.Clear()
    }
  }

  [ordered]@{
    activeStreamCount = $activeLeases.Count
    activeLeaseIds = @($activeLeases.Keys)
    auditPaths = $auditPaths
    dataRoot = $dataRoot
    windowMinutes = $activeStreamAuditWindowMinutes
    lastEventTimestampMs = $lastEventTimestampMs
    parseErrorCount = $parseErrorCount
  }
}

function Wait-UntilNoActiveCodexStreams {
  while ($true) {
    $guard = Get-ActiveCodexLocalAccessStreamSnapshot
    if ([int]$guard.activeStreamCount -le 0) {
      Write-RunnerEvent @{ event = "active_stream_guard_clear_before_debug_switch"; activeCodexStreamGuard = $guard }
      return
    }
    Write-RunnerEvent @{ event = "debug_switch_runner_waiting_for_active_streams"; activeCodexStreamGuard = $guard }
    Start-Sleep -Seconds 2
  }
}

function Stop-ReleaseProcessesBeforeDebugLaunch {
  $results = @()
  foreach ($id in $stopPids) {
    $result = [ordered]@{
      processId = $id
      closeMainWindow = $false
      forcedStop = $false
      exited = $false
      error = $null
    }
    try {
      $process = Get-Process -Id $id -ErrorAction Stop
      $result.name = $process.ProcessName
      if ($process.MainWindowHandle -ne 0) {
        $result.closeMainWindow = [bool]$process.CloseMainWindow()
      }
      $deadline = (Get-Date).AddSeconds($gracefulStopTimeoutSeconds)
      while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        $stillRunning = Get-Process -Id $id -ErrorAction SilentlyContinue
        if (-not $stillRunning) {
          $result.exited = $true
          break
        }
      }
      if (-not $result.exited) {
        $stillRunning = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($stillRunning) {
          Stop-Process -Id $id -Force -ErrorAction Stop
          $result.forcedStop = $true
          Start-Sleep -Milliseconds 500
          $result.exited = -not [bool](Get-Process -Id $id -ErrorAction SilentlyContinue)
        }
      }
    } catch {
      $result.error = $_.Exception.Message
    }
    $results += [pscustomobject]$result
  }
  Write-RunnerEvent @{ event = "release_processes_stopped_by_debug_switch_runner"; processes = $results }
}

$cargoArgs = @($args)
Write-RunnerEvent @{ event = "debug_switch_runner_ready"; cargoArgs = $cargoArgs; stopPids = $stopPids }
Wait-UntilNoActiveCodexStreams
Stop-ReleaseProcessesBeforeDebugLaunch
Push-Location -LiteralPath $repoRoot
try {
  Write-RunnerEvent @{ event = "debug_switch_runner_starting_cargo"; cargoArgs = $cargoArgs; repoRoot = $repoRoot }
  & cargo.exe @cargoArgs
  $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
  Write-RunnerEvent @{ event = "debug_switch_runner_cargo_exited"; cargoArgs = $cargoArgs; exitCode = $exitCode }
  exit $exitCode
} finally {
  Pop-Location
}
