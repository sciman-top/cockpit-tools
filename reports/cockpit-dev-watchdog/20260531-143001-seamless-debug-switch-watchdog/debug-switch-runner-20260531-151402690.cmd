@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "D:\CODE\external\Cockpit-Tools-Local\reports\cockpit-dev-watchdog\20260531-143001-seamless-debug-switch-watchdog\debug-switch-runner-20260531-151402690.ps1" %*
exit /b %ERRORLEVEL%
