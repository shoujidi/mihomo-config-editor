@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop.ps1"
if errorlevel 1 (
  echo.
  echo 停止程序时发生错误。
  pause
) else (
  timeout /t 2 /nobreak >nul
)

