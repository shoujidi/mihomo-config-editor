[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$portableRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $portableRoot 'runtime\node.exe'
$serverPath = Join-Path $portableRoot 'server.mjs'

function Test-OwnServer([int]$Port) {
  $connected = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($connected.Count -ne 1) { return $false }
  try {
    $process = Get-Process -Id $connected[0].OwningProcess -ErrorAction Stop
    if (-not [string]::Equals($process.Path, $nodePath, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    $result = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/portable-ready" -UseBasicParsing -TimeoutSec 1
    return $result.StatusCode -eq 200 -and ($result.Content | ConvertFrom-Json).offline -eq $true
  } catch { return $false }
}

function Open-Editor([int]$Port) {
  if ($NoBrowser) { return }
  $address = "http://127.0.0.1:$Port/"
  try { Start-Process -FilePath $address -ErrorAction Stop }
  catch { Write-Warning "无法打开默认浏览器，请手动打开 $address" }
}

$availablePort = $null
foreach ($port in 4173..4183) {
  if (Test-OwnServer $port) {
    Write-Host "本副本已在运行：http://127.0.0.1:$port/"
    Write-Host '请关闭首次启动时打开的窗口来停止编辑器。'
    Open-Editor $port
    exit 0
  }
  if ($null -eq $availablePort -and -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    $availablePort = $port
  }
}
if ($null -eq $availablePort) { throw '端口 4173–4183 均被占用，请稍后再试。' }

$env:PORT = [string]$availablePort
$env:MIHOMO_PORTABLE_OPEN_BROWSER = $(if ($NoBrowser) { '0' } else { '1' })
$env:MIHOMO_PORTABLE_CONSOLE = '1'

# Keep Node in the foreground and attached to the launcher's Windows console.
# Closing that console delivers Windows' close event to this process, too.
& $nodePath $serverPath
exit $LASTEXITCODE
