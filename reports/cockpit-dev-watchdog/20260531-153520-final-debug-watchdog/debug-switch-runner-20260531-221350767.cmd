@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\CODE\external\Cockpit-Tools-Local\reports\cockpit-dev-watchdog\20260531-153520-final-debug-watchdog\debug-switch-runner-20260531-221350767.ps1" %*
exit /b %ERRORLEVEL%
