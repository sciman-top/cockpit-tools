param(
  [int]$TestThreads = 1
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot "src-tauri\Cargo.toml"

$tests = @(
  "previous_response_id_hard_affinity_blocks_fallback_after_usage_limit",
  "previous_response_id_short_retry_after_retries_original_account_to_completion",
  "hard_affinity_followup_retries_short_reset_on_original_account",
  "active_stream_request_affinity_blocks_old_task_fallback_but_allows_new_task",
  "in_flight_stream_finishes_on_original_account_while_new_task_uses_replacement",
  "active_stream_lease_survives_cooldown_until_terminal_release",
  "stream_write_state_blocks_fallback_after_headers_or_first_chunk",
  "upstream_stream_error_sse_has_explicit_failed_terminal_event",
  "successful_model_admission_clears_only_that_persisted_model_cooldown"
)

foreach ($test in $tests) {
  Write-Host "RUN $test"
  & cargo test --manifest-path $manifestPath $test --lib -- --test-threads=$TestThreads
  if ($LASTEXITCODE -ne 0) {
    throw "continuity focused test failed: $test"
  }
}

"PASS Codex API service continuity focused tests"
