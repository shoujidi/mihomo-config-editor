@echo off
setlocal
if not exist "%~dp0tools\start.ps1" goto incomplete
if not exist "%~dp0runtime\node.exe" goto incomplete
if not exist "%~dp0dist\index.html" goto incomplete
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start.ps1" %*
set "result=%ERRORLEVEL%"
if "%result%"=="0" exit /b 0
echo(
echo Startup failed. Review the error above.
pause
exit /b %result%
:incomplete
echo(
echo Portable files are missing. Extract the entire ZIP first.
echo Then run this launcher from the extracted folder, not inside the ZIP.
pause
exit /b 2
