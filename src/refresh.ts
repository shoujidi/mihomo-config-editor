import { isMap, isSeq, parseDocument, Scalar } from 'yaml'
import { parseConfig, type ProxyNode } from './core'

export type RefreshCandidate = { id: string; file: string; node: ProxyNode }

function protocol(node: ProxyNode) { return String(node.type ?? '').toLowerCase() }
function usable(node: ProxyNode) {
  return Boolean(node.name.trim() && protocol(node) && typeof node.server === 'string' && node.server.trim()
    && /^\d+$/.test(String(node.port ?? '')) && Number(node.port) >= 1 && Number(node.port) <= 65535
    && !/^(剩余流量|剩余时间|距离下次重置|套餐到期|到期时间|流量重置|订阅到期|traffic left|expire date|subscription expiry)(?:\s|[:：｜|]|$)/iu.test(node.name.trim()))
}

export function readRefreshFile(source: string, file: string, fileId: number): RefreshCandidate[] {
  const candidates = parseConfig(source.replace(/^\uFEFF/, '')).proxies
    .filter(usable).map((node, index) => ({ id: `${fileId}:${index}`, file, node }))
  if (!candidates.length) throw new Error('没有可刷新的内联节点（需要包含 proxies 的本地 YAML）')
  return candidates
}

export function refreshRows(target: ProxyNode[], candidates: RefreshCandidate[]) {
  const counts = new Map<string, number>()
  const matches = new Map<string, RefreshCandidate[]>()
  const key = (node: ProxyNode) => JSON.stringify([node.name, protocol(node)])
  for (const node of target) counts.set(node.name, (counts.get(node.name) ?? 0) + 1)
  for (const candidate of candidates) {
    const k = key(candidate.node)
    const entries = matches.get(k) ?? []
    entries.push(candidate)
    matches.set(k, entries)
  }
  return target.map((node) => {
    const exact = matches.get(key(node)) ?? []
    const blocked = counts.get(node.name) !== 1
    return { node, blocked, auto: blocked || exact.length !== 1 ? undefined : exact[0].id, ambiguous: exact.length > 1 }
  })
}

export function applyRefresh(source: string, choices: ReadonlyMap<string, RefreshCandidate>): string {
  if (!choices.size) return source
  const doc = parseDocument(source, { uniqueKeys: true })
  const proxies = doc.get('proxies', true)
  if (doc.errors.length || !isSeq(proxies)) throw new Error('目标配置无效')
  const untouched = (content: unknown) => {
    const snapshot = content as Record<string, unknown>
    const nodes = snapshot.proxies as Array<{ name?: string; 'dialer-proxy'?: unknown } | null>
    return JSON.stringify({ ...snapshot, proxies: nodes.map((node) => node?.name && choices.has(node.name) ? { name: node.name, dialer: node['dialer-proxy'] } : node) })
  }
  const before = untouched(doc.toJS())
  const used = new Set<string>()
  const completed = new Set<string>()
  for (const entry of proxies.items) {
    if (!isMap(entry)) continue
    const name = entry.get('name')
    if (typeof name !== 'string') continue
    const choice = choices.get(name)
    if (!choice) continue
    if (completed.has(name) || used.has(choice.id) || !usable(choice.node)
      || protocol(choice.node) !== String(entry.get('type') ?? '').toLowerCase()) {
      throw new Error('刷新映射有重复项或协议不一致，请重新预览')
    }
    const replacement = doc.createNode(choice.node)
    if (!isMap(replacement)) throw new Error('刷新节点无效')
    for (const pair of [...entry.items]) {
      if (!(pair.key instanceof Scalar) || typeof pair.key.value !== 'string') continue
      const key = pair.key.value
      if (key !== 'name' && key !== 'dialer-proxy' && !replacement.has(key)) entry.delete(key)
    }
    for (const pair of replacement.items) {
      if (!(pair.key instanceof Scalar) || typeof pair.key.value !== 'string') continue
      const key = pair.key.value
      if (key !== 'name' && key !== 'dialer-proxy') entry.set(key, pair.value)
    }
    completed.add(name)
    used.add(choice.id)
  }
  if (completed.size !== choices.size) throw new Error('目标节点已变化，请重新预览')
  const result = doc.toString({ lineWidth: 0 })
  try {
    const parsed = parseDocument(result, { uniqueKeys: true })
    if (parsed.errors.length || untouched(parsed.toJS()) !== before) throw new Error()
  } catch { throw new Error('刷新将影响其他设置或 YAML 共享引用，已取消。') }
  return result
}
