[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$portableRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $portableRoot 'runtime\node.exe'
$statePath = Join-Path $portableRoot 'data\editor-state.json'
$stopped = 0

function Stop-LocalProcess([int]$editorProcessId) {
  $process = Get-Process -Id $editorProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  try {
    if (-not [string]::Equals($process.Path, $nodePath, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    Stop-Process -Id $editorProcessId -Force
    return $true
  } catch { return $false }
}

if (Test-Path -LiteralPath $statePath) {
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if (Stop-LocalProcess ([int]$state.processId)) { $stopped += 1 }
  } catch { }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $nodePath, [System.StringComparison]::OrdinalIgnoreCase)) {
    if (Stop-LocalProcess ([int]$_.ProcessId)) { $stopped += 1 }
  }
}

if ($stopped -gt 0) { Write-Host '机场配置修改工具后台程序已停止。' }
else { Write-Host '机场配置修改工具当前没有运行。' }

