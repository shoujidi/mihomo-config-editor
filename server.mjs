import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.PORT || 4173)
const projectDirectory = fileURLToPath(new URL('.', import.meta.url))
const root = join(projectDirectory, 'dist')
const shares = new Map()
const MAX_FILE_SIZE = 50 * 1024 * 1024
const SHARE_LIFETIME = 30 * 60 * 1000

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8',
}

function lanAddress() {
  const candidates = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal) candidates.push(item.address)
    }
  }
  return candidates.find((ip) => /^192\.168\./.test(ip))
    || candidates.find((ip) => /^10\./.test(ip))
    || candidates.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
    || candidates[0]
    || '127.0.0.1'
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

function safeFilename(value) {
  try { value = decodeURIComponent(value || '') } catch { value = 'shared-file' }
  return String(value || 'shared-file').replace(/[\r\n"\\/]/g, '_').slice(0, 180)
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(root, safe)
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = join(filePath, 'index.html')
    const data = await readFile(filePath)
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream' })
    response.end(data)
  } catch {
    try {
      const data = await readFile(join(root, 'index.html'))
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(data)
    } catch {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Build files are missing. Run pnpm build first.')
    }
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'POST' && url.pathname === '/api/share') {
    const length = Number(request.headers['content-length'] || 0)
    if (!length || length > MAX_FILE_SIZE) return json(response, 413, { error: '文件不能为空且不能超过 50 MB' })
    const chunks = []
    let received = 0
    request.on('data', (chunk) => {
      received += chunk.length
      if (received > MAX_FILE_SIZE) request.destroy()
      else chunks.push(chunk)
    })
    request.on('end', () => {
      if (!received || received > MAX_FILE_SIZE) return json(response, 413, { error: '文件不能为空且不能超过 50 MB' })
      const token = randomBytes(18).toString('base64url')
      const expiresAt = Date.now() + SHARE_LIFETIME
      const filename = safeFilename(request.headers['x-file-name'])
      shares.set(token, { data: Buffer.concat(chunks), filename, type: request.headers['content-type'] || 'application/octet-stream', expiresAt })
      const downloadUrl = `http://${lanAddress()}:${port}/download/${token}`
      json(response, 200, { url: downloadUrl, filename, size: received, expiresAt })
    })
    request.on('error', () => { if (!response.headersSent) json(response, 400, { error: '文件读取失败' }) })
    return
  }

  const match = url.pathname.match(/^\/download\/([A-Za-z0-9_-]+)$/)
  if (request.method === 'GET' && match) {
    const share = shares.get(match[1])
    if (!share || share.expiresAt < Date.now()) {
      shares.delete(match[1])
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return response.end('文件不存在或二维码已过期')
    }
    response.writeHead(200, {
      'Content-Type': share.type,
      'Content-Length': share.data.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(share.filename)}`,
      'Cache-Control': 'no-store',
    })
    return response.end(share.data)
  }

  if (request.method === 'GET' && url.pathname === '/api/share-info') {
    return json(response, 200, { address: lanAddress(), port, maxFileSize: MAX_FILE_SIZE, lifetimeMinutes: 30 })
  }

  if (url.pathname.startsWith('/api/')) return json(response, 404, { error: '接口不存在，请关闭旧窗口后重新启动编辑器' })
  if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response)
  response.writeHead(405).end()
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.log(`机场配置修改工具已在运行，正在打开现有窗口: http://127.0.0.1:${port}`)
    process.exit(0)
  }
  console.error(`启动失败: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

setInterval(() => {
  const now = Date.now()
  for (const [token, share] of shares) if (share.expiresAt < now) shares.delete(token)
}, 60_000).unref()

server.listen(port, '0.0.0.0', () => {
  console.log(`机场配置修改工具: http://127.0.0.1:${port}`)
  console.log(`Phone access: http://${lanAddress()}:${port}`)
  console.log('Keep this window open while transferring files.')
})
