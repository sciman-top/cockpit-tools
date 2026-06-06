param()

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$trackedFiles = & git -C $repoRoot ls-files
if ($LASTEXITCODE -ne 0) {
  throw "failed to list git tracked files"
}

$violations = @()
foreach ($relativePath in $trackedFiles) {
  if ([string]::IsNullOrWhiteSpace($relativePath)) {
    continue
  }

  $normalizedPath = $relativePath -replace '\\', '/'
  if ($normalizedPath -match '^(dist|target|target-[^/]+|node_modules)/') {
    continue
  }

  $path = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    continue
  }

  $lineNumber = 0
  foreach ($line in [System.IO.File]::ReadLines($path)) {
    $lineNumber += 1
    if ($line -match '^(<<<<<<<|=======|>>>>>>>)(\s|$)') {
      $violations += ("{0}:{1}: {2}" -f $relativePath, $lineNumber, $line)
    }
  }
}

if ($violations.Count -gt 0) {
  throw ("merge conflict markers found:`n{0}" -f ($violations -join "`n"))
}

"PASS merge conflict marker check"
