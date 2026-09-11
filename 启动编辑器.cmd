@echo off
chcp 65001 >nul
setlocal
set "PROJECT_DIR=%~dp0"
set "BUNDLED_NODE=C:\Users\47557\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "SERVER_JS=%PROJECT_DIR%server.mjs"

if exist "%BUNDLED_NODE%" goto bundled_node
where node >nul 2>nul
if errorlevel 1 goto no_node
set "NODE_EXE=node"
goto node_ready

:bundled_node
set "NODE_EXE=%BUNDLED_NODE%"

:node_ready
if not exist "%SERVER_JS%" goto no_dependencies
if not exist "%PROJECT_DIR%dist\index.html" goto no_build

set "EDITOR_PORT="
for /f "delims=" %%P in ('powershell.exe -NoProfile -Command "$p=4173; while($p -le 4183 -and (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)){ $p++ }; if($p -le 4183){ Write-Output $p }"') do set "EDITOR_PORT=%%P"
if not defined EDITOR_PORT goto no_port
set "PORT=%EDITOR_PORT%"

echo Starting 机场配置修改工具 at http://127.0.0.1:%EDITOR_PORT% ...
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%EDITOR_PORT%'"
"%NODE_EXE%" "%SERVER_JS%"
if errorlevel 1 pause
exit /b %errorlevel%

:no_port
echo ERROR: Ports 4173 through 4183 are all in use.
pause
exit /b 1

:no_node
echo ERROR: Node.js was not found.
echo Install Node.js 18 or newer, then run this launcher again.
pause
exit /b 1

:no_dependencies
echo ERROR: Project dependencies are missing.
echo Run pnpm install in this project directory first.
pause
exit /b 1

:no_build
echo ERROR: Production build is missing.
echo Run pnpm build in this project directory first.
pause
exit /b 1
