@echo off
setlocal
if not exist "%~dp0tools\stop.ps1" goto incomplete
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"
set "result=%ERRORLEVEL%"
if "%result%"=="0" exit /b 0
echo(
echo Stop failed. Review the error above.
pause
exit /b %result%
:incomplete
echo Portable files are missing. Extract the entire ZIP first.
pause
exit /b 2
