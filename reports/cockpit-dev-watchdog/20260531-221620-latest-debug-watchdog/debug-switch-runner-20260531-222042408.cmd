@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\CODE\external\Cockpit-Tools-Local\reports\cockpit-dev-watchdog\20260531-221620-latest-debug-watchdog\debug-switch-runner-20260531-222042408.ps1" %*
exit /b %ERRORLEVEL%
