[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$portableRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $portableRoot 'runtime\node.exe'
$serverPath = Join-Path $portableRoot 'server.mjs'
$distIndex = Join-Path $portableRoot 'dist\index.html'
$dataDirectory = Join-Path $portableRoot 'data'
$statePath = Join-Path $dataDirectory 'editor-state.json'

function Open-Editor([int]$editorPort) {
  if ($NoBrowser) { return }
  $address = "http://127.0.0.1:$editorPort/"
  try { Start-Process -FilePath $address -ErrorAction Stop }
  catch { Write-Warning "无法打开默认浏览器，请手动打开 $address" }
}

function Test-Editor([int]$editorPort) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$editorPort/api/portable-ready" -UseBasicParsing -TimeoutSec 1
    return ($response.StatusCode -eq 200) -and (($response.Content | ConvertFrom-Json).offline -eq $true)
  } catch {
    return $false
  }
}

function Test-LocalNodeProcess([int]$editorProcessId) {
  $process = Get-Process -Id $editorProcessId -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  try { return [string]::Equals($process.Path, $nodePath, [System.StringComparison]::OrdinalIgnoreCase) }
  catch { return $false }
}

if (-not (Test-Path -LiteralPath $nodePath)) { throw '便携运行环境不完整：缺少 runtime\node.exe' }
if (-not (Test-Path -LiteralPath $serverPath)) { throw '便携运行环境不完整：缺少 server.mjs' }
if (-not (Test-Path -LiteralPath $distIndex)) { throw '便携运行环境不完整：缺少 dist\index.html' }
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

if (Test-Path -LiteralPath $statePath) {
  try {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $savedProcessId = [int]$state.processId
    $savedPort = [int]$state.port
    if ((Test-LocalNodeProcess $savedProcessId) -and (Test-Editor $savedPort)) {
      Write-Host "机场配置修改工具已经运行，正在打开端口 $savedPort。"
      Open-Editor $savedPort
      exit 0
    }
  } catch { }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

foreach ($candidatePort in 4173..4183) {
  $listeners = Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $existingProcessId = [int]$listener.OwningProcess
    if ((Test-LocalNodeProcess $existingProcessId) -and (Test-Editor $candidatePort)) {
      @{ processId = $existingProcessId; port = $candidatePort; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
      Write-Host "已找到正在运行的便携版，正在打开端口 $candidatePort。"
      Open-Editor $candidatePort
      exit 0
    }
  }
}

$availablePort = $null
foreach ($candidatePort in 4173..4183) {
  if (-not (Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue)) {
    $availablePort = $candidatePort
    break
  }
}
if ($null -eq $availablePort) { throw '端口 4173–4183 均被占用，请关闭占用端口的程序后重试。' }

$previousPort = $env:PORT
try {
  $env:PORT = [string]$availablePort
  $editorProcess = Start-Process -FilePath $nodePath -ArgumentList @("`"$serverPath`"") -WorkingDirectory $portableRoot -WindowStyle Hidden -PassThru
} finally {
  if ($null -eq $previousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
  else { $env:PORT = $previousPort }
}

@{ processId = $editorProcess.Id; port = $availablePort; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

$ready = $false
for ($attempt = 0; $attempt -lt 24; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  if (Test-Editor $availablePort) { $ready = $true; break }
  if (-not (Get-Process -Id $editorProcess.Id -ErrorAction SilentlyContinue)) { break }
}
if (-not $ready) {
  if (Test-LocalNodeProcess $editorProcess.Id) { Stop-Process -Id $editorProcess.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  throw '编辑器服务启动失败，请确认便携目录文件完整且未被安全软件拦截。'
}

Write-Host "机场配置修改工具已启动：http://127.0.0.1:$availablePort/"
Open-Editor $availablePort
