import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const host = '127.0.0.1'
const port = Number(process.env.PORT || 4173)
const root = fileURLToPath(new URL('./dist', import.meta.url))
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

const server = createServer(async (request, response) => {
  if (request.headers.host !== `${host}:${port}`) return response.writeHead(403).end()
  if (request.method !== 'GET' && request.method !== 'HEAD') return response.writeHead(405).end()
  try {
    const url = new URL(request.url, `http://${host}:${port}`)
    if (url.pathname === '/api/portable-ready') {
      return response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"offline":true}')
    }
    const file = resolve(root, url.pathname === '/' ? 'index.html' : '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + sep) || !types[extname(file)]) return response.writeHead(404).end()
    const bytes = await readFile(file)
    response.writeHead(200, {
      'Content-Type': types[extname(file)],
      'Content-Length': bytes.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  } catch { response.writeHead(404).end() }
})
server.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
server.listen(port, host, () => {
  const address = `http://${host}:${port}/`
  console.log(`机场配置修改工具：${address}`)
  console.log('保持此命令窗口打开；关闭此窗口即停止编辑器。')
  if (process.env.MIHOMO_PORTABLE_OPEN_BROWSER !== '1' || process.platform !== 'win32') return
  const powershell = resolve(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${address}' -ErrorAction Stop`], {
    windowsHide: true, detached: true, stdio: 'ignore',
  })
  child.on('error', () => console.warn(`无法启动默认浏览器，请手动打开 ${address}`))
  child.on('exit', (code) => { if (code) console.warn(`无法启动默认浏览器，请手动打开 ${address}`) })
  child.unref()
})
