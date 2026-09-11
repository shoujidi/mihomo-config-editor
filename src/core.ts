import { parseDocument, isMap, isSeq, YAMLMap, YAMLSeq, Scalar } from 'yaml'

export type ProxyNode = {
  name: string
  type?: string
  server?: string
  port?: number | string
  [key: string]: unknown
}

export type ProxyGroup = {
  name: string
  type?: string
  proxies?: string[]
  [key: string]: unknown
}

export type ExitSettings = {
  type: 'socks5' | 'http'
  label: string
  server: string
  port: number
  username?: string
  password?: string
  udp: boolean
  tls: boolean
  skipCertVerify: boolean
  nameTemplate: string
  createGroup: boolean
  groupName: string
  syncSourceGroups: boolean
}

export type ParsedConfig = {
  proxies: ProxyNode[]
  groups: ProxyGroup[]
  warnings: string[]
}

export type BuildResult = {
  yaml: string
  generatedNames: string[]
  warnings: string[]
}

export type CopyConflictStrategy = 'rename' | 'skip' | 'replace'

export type CopyProxyResult = {
  yaml: string
  copiedNames: string[]
  skippedNames: string[]
  renamed: NodeRename[]
  dependencyCount: number
  conflictCount: number
}

export type NodeRename = {
  from: string
  to: string
}

export type ProxyGroupOrder = {
  groupName: string
  proxies: string[]
}

export type RuleReference = {
  id: string
  section: string
  index: number
  text: string
}

export type ParsedProxyInput = {
  type?: 'socks5' | 'http'
  server: string
  port: number
  username?: string
  password?: string
  tls?: boolean
  format: string
}

const HOST_KEYS = ['server', 'host', 'hostname', 'ip', 'proxy_ip', 'proxyip', '代理ip', '地址', '主机']
const PORT_KEYS = ['port', 'proxy_port', 'proxyport', '端口']
const USER_KEYS = ['username', 'user', 'account', 'login', 'proxy_user', '账号', '账户', '用户名']
const PASS_KEYS = ['password', 'pass', 'pwd', 'proxy_password', '密码']
const TYPE_KEYS = ['protocol', 'scheme', 'type', 'proxy_type', '协议', '类型']
const RULE_SPECIAL_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'])
const GROUP_SPECIAL_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP'])

function normalizeProtocol(value?: unknown): Pick<ParsedProxyInput, 'type' | 'tls'> {
  const protocol = String(value ?? '').toLowerCase().replace(/:$/, '')
  if (protocol === 'https') return { type: 'http', tls: true }
  if (protocol === 'http') return { type: 'http', tls: false }
  if (protocol === 'socks' || protocol === 'socks5' || protocol === 'socks5h') return { type: 'socks5', tls: false }
  return {}
}

function validPort(value: unknown): number | undefined {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

function cleanHost(value: unknown): string {
  return String(value ?? '').trim().replace(/^\[|\]$/g, '')
}

function pickObjectValue(object: Record<string, unknown>, keys: string[]): unknown {
  const entries = Object.entries(object)
  for (const key of keys) {
    const match = entries.find(([candidate]) => candidate.toLowerCase().replace(/[\s-]/g, '_') === key)
    if (match && match[1] !== '') return match[1]
  }
  return undefined
}

function parseProxyObject(value: unknown): ParsedProxyInput | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = parseProxyObject(item)
      if (result) return result
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const object = value as Record<string, unknown>
  for (const key of ['proxy', 'url', 'proxy_url', 'proxyUrl', 'connection']) {
    if (typeof object[key] === 'string') {
      try { return parseProxyInput(object[key] as string) } catch { /* try structured keys */ }
    }
  }
  const server = cleanHost(pickObjectValue(object, HOST_KEYS))
  const port = validPort(pickObjectValue(object, PORT_KEYS))
  if (!server || !port) return undefined
  const username = pickObjectValue(object, USER_KEYS)
  const password = pickObjectValue(object, PASS_KEYS)
  return {
    ...normalizeProtocol(pickObjectValue(object, TYPE_KEYS)),
    server,
    port,
    username: username == null ? undefined : String(username),
    password: password == null ? undefined : String(password),
    format: 'JSON / 对象字段',
  }
}

function fromParts(server: string, portValue: string, username?: string, password?: string, format = '分隔格式'): ParsedProxyInput | undefined {
  const port = validPort(portValue)
  const host = cleanHost(server)
  if (!host || !port || /\s/.test(host)) return undefined
  return { server: host, port, username: username || undefined, password: password || undefined, format }
}

/** Parse the one-click copy formats used by common proxy providers. */
export function parseProxyInput(input: string): ParsedProxyInput {
  const raw = input.replace(/^\uFEFF/, '').trim()
  if (!raw) throw new Error('请粘贴代理 IP 信息')

  if (/^[\[{]/.test(raw)) {
    try {
      const objectResult = parseProxyObject(JSON.parse(raw))
      if (objectResult) return objectResult
    } catch { /* continue with text formats */ }
  }

  const keyValues: Record<string, string> = {}
  const keyPattern = /(?:^|[\s,;|])([\w\u4e00-\u9fff-]+)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;|]+)/g
  for (const match of raw.matchAll(keyPattern)) keyValues[match[1].toLowerCase()] = match[2].replace(/^['"]|['"]$/g, '')
  const objectResult = parseProxyObject(keyValues)
  if (objectResult) return { ...objectResult, format: '键值字段' }

  const candidates = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const lines = candidates.length ? candidates : [raw]
  for (const line of lines) {
    const value = line.replace(/^["']|["']$/g, '').trim()
    const urlCandidate = /^[a-z][\w+.-]*:\/\//i.test(value) ? value : undefined
    if (urlCandidate) {
      try {
        const url = new URL(urlCandidate)
        const port = validPort(url.port)
        if (url.hostname && port) {
          return {
            ...normalizeProtocol(url.protocol),
            server: cleanHost(url.hostname),
            port,
            username: url.username ? decodeURIComponent(url.username) : undefined,
            password: url.password ? decodeURIComponent(url.password) : undefined,
            format: `${url.protocol.replace(':', '').toUpperCase()} 链接`,
          }
        }
      } catch { /* try provider formats */ }
    }

    let match = value.match(/^(?:([a-z][\w+.-]*):\/\/)?([^:@\s/]+):([^@\s/]+)@(\[[^\]]+\]|[^:\s/]+):(\d{1,5})(?:[/#?].*)?$/i)
    if (match) {
      const result = fromParts(match[4], match[5], decodeURIComponent(match[2]), decodeURIComponent(match[3]), '账号:密码@IP:端口')
      if (result) return { ...result, ...normalizeProtocol(match[1]) }
    }

    match = value.match(/^(\[[^\]]+\]|[^:@\s/]+):(\d{1,5})@([^:\s]+):(.+)$/)
    if (match) {
      const result = fromParts(match[1], match[2], match[3], match[4], 'IP:端口@账号:密码')
      if (result) return result
    }

    const delimited = value.split(/\s*[|,;\t]\s*/)
    if (delimited.length >= 2) {
      const result = fromParts(delimited[0], delimited[1], delimited[2], delimited.slice(3).join(delimited.length > 4 ? ':' : '') || undefined, '表格 / 分隔符')
      if (result) return result
    }

    const colonParts = value.split(':')
    if (colonParts.length >= 4 && validPort(colonParts[1])) {
      const result = fromParts(colonParts[0], colonParts[1], colonParts[2], colonParts.slice(3).join(':'), 'IP:端口:账号:密码')
      if (result) return result
    }
    if (colonParts.length >= 4 && validPort(colonParts.at(-1)) && /[.\[]/.test(colonParts.at(-2) ?? '')) {
      const result = fromParts(colonParts.at(-2)!, colonParts.at(-1)!, colonParts[0], colonParts.slice(1, -2).join(':'), '账号:密码:IP:端口')
      if (result) return result
    }

    match = value.match(/^(\[[^\]]+\]|[^:\s]+):(\d{1,5})$/)
    if (match) {
      const result = fromParts(match[1], match[2], undefined, undefined, 'IP:端口')
      if (result) return result
    }
  }

  if (lines.length >= 2) {
    const result = fromParts(lines[0], lines[1], lines[2], lines.slice(3).join('\n') || undefined, '多行字段')
    if (result) return result
  }
  throw new Error('未识别代理格式，请检查 IP、端口及分隔符')
}

const asObjectArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : []

export function parseConfig(source: string): ParsedConfig {
  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors[0].message)
  const root = doc.toJS() as Record<string, unknown> | null
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('YAML 顶层必须是一个对象')

  const warnings: string[] = []
  const proxies = asObjectArray(root.proxies).filter((item) => typeof item.name === 'string') as ProxyNode[]
  const groups = asObjectArray(root['proxy-groups']).filter((item) => typeof item.name === 'string') as ProxyGroup[]

  if (!Array.isArray(root.proxies)) warnings.push('未找到 proxies 列表，将在生成时创建')
  if (!proxies.length) warnings.push('配置中没有可选择的内联节点')
  if (root['proxy-providers']) warnings.push('proxy-providers 中的远程节点无法在浏览器内展开；请使用订阅转换后的完整 YAML')
  return { proxies, groups, warnings }
}

export function validateSettings(settings: ExitSettings): string[] {
  const errors: string[] = []
  if (!settings.server.trim()) errors.push('请填写出口服务器 IP 或域名')
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) errors.push('端口必须是 1–65535 的整数')
  if (!settings.label.trim()) errors.push('请填写出口标识')
  if (!settings.nameTemplate.includes('{node}') && !settings.nameTemplate.includes('{exit}')) {
    errors.push('命名模板至少应包含 {node} 或 {exit}')
  }
  if (settings.createGroup && !settings.groupName.trim()) errors.push('请填写出口策略组名称')
  return errors
}

function formatName(template: string, node: string, exit: string): string {
  return template.replaceAll('{node}', node).replaceAll('{exit}', exit).trim()
}

function uniqueName(wanted: string, used: Set<string>): string {
  if (!used.has(wanted)) {
    used.add(wanted)
    return wanted
  }
  let index = 2
  while (used.has(`${wanted} (${index})`)) index += 1
  const result = `${wanted} (${index})`
  used.add(result)
  return result
}

function uniqueCopiedName(wanted: string, used: Set<string>): string {
  const first = `${wanted} (复制)`
  if (!used.has(first)) {
    used.add(first)
    return first
  }
  let index = 2
  while (used.has(`${wanted} (复制 ${index})`)) index += 1
  const result = `${wanted} (复制 ${index})`
  used.add(result)
  return result
}

function createExitNode(name: string, dialer: string, settings: ExitSettings): ProxyNode {
  const node: ProxyNode = {
    name,
    type: settings.type,
    server: settings.server.trim(),
    port: settings.port,
  }
  if (settings.username?.trim()) node.username = settings.username.trim()
  if (settings.password) node.password = settings.password
  if (settings.type === 'socks5' && settings.udp) node.udp = true
  if (settings.tls) node.tls = true
  if (settings.tls && settings.skipCertVerify) node['skip-cert-verify'] = true
  node['dialer-proxy'] = dialer
  return node
}

function mapGet(map: YAMLMap, key: string): unknown {
  return map.get(key, true)
}

function scalarValue(node: unknown): unknown {
  return node instanceof Scalar ? node.value : node
}

function editableProxySequence(source: string) {
  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors[0].message)
  if (!isMap(doc.contents)) throw new Error('YAML 顶层必须是一个对象')
  const proxies = doc.get('proxies', true)
  if (!isSeq(proxies)) throw new Error('proxies 必须是列表')
  return { doc, proxies }
}

function proxyNodeName(node: unknown): string {
  if (!isMap(node)) return ''
  return String(scalarValue(node.get('name', true)) ?? '')
}

function ruleTarget(rule: string): { parts: string[]; index: number; value: string } | undefined {
  const parts = rule.split(',')
  if (parts.length < 2) return undefined
  const last = parts.length - 1
  const index = parts[last].trim().toLowerCase() === 'no-resolve' ? last - 1 : last
  if (index < 1) return undefined
  return { parts, index, value: parts[index].trim() }
}

function eachRuleSequence(doc: ReturnType<typeof parseDocument>, visit: (rules: YAMLSeq) => void) {
  const rules = doc.get('rules', true)
  if (isSeq(rules)) visit(rules)
  const subRules = doc.get('sub-rules', true)
  if (isMap(subRules)) {
    for (const pair of subRules.items) if (isSeq(pair.value)) visit(pair.value)
  }
}

function namedRuleSequences(doc: ReturnType<typeof parseDocument>) {
  const result: { section: string; rules: YAMLSeq }[] = []
  const rules = doc.get('rules', true)
  if (isSeq(rules)) result.push({ section: 'rules', rules })
  const subRules = doc.get('sub-rules', true)
  if (isMap(subRules)) {
    for (const pair of subRules.items) {
      if (isSeq(pair.value)) result.push({ section: `sub-rules/${String(scalarValue(pair.key))}`, rules: pair.value })
    }
  }
  return result
}

function syncRuleTargets(doc: ReturnType<typeof parseDocument>, renames: Map<string, string>) {
  eachRuleSequence(doc, (rules) => {
    for (const item of rules.items) {
      if (!(item instanceof Scalar) || typeof item.value !== 'string') continue
      const target = ruleTarget(item.value)
      const replacement = target && renames.get(target.value)
      if (!target || replacement == null) continue
      const original = target.parts[target.index]
      const leading = original.match(/^\s*/)?.[0] ?? ''
      const trailing = original.match(/\s*$/)?.[0] ?? ''
      target.parts[target.index] = `${leading}${replacement}${trailing}`
      item.value = target.parts.join(',')
    }
  })
}

function syncDialerProxyTargets(doc: ReturnType<typeof parseDocument>, renames: Map<string, string>) {
  const proxies = doc.get('proxies', true)
  if (!isSeq(proxies)) return
  for (const node of proxies.items) {
    if (!isMap(node)) continue
    const dialer = scalarValue(node.get('dialer-proxy', true))
    const replacement = typeof dialer === 'string' ? renames.get(dialer) : undefined
    if (replacement != null) node.set('dialer-proxy', replacement)
  }
}

function removeRulesTargeting(doc: ReturnType<typeof parseDocument>, removed: Set<string>) {
  eachRuleSequence(doc, (rules) => {
    rules.items = rules.items.filter((item) => {
      if (!(item instanceof Scalar) || typeof item.value !== 'string') return true
      const target = ruleTarget(item.value)
      return !target || !removed.has(target.value)
    })
  })
}

/** Rename nodes and keep every inline proxy-group reference in sync. */
export function renameProxyNodes(source: string, renames: NodeRename[]): string {
  const { doc, proxies } = editableProxySequence(source)
  const renameMap = new Map(renames.map(({ from, to }) => [from, to.trim()]))
  const currentNames = proxies.items.map(proxyNodeName)
  const finalNames = currentNames.map((name) => renameMap.get(name) ?? name)
  const existingGroups = doc.get('proxy-groups', true)
  const groupNames = new Set(isSeq(existingGroups) ? existingGroups.items.map((group) => isMap(group) ? String(scalarValue(group.get('name', true)) ?? '') : '') : [])

  if (finalNames.some((name) => !name)) throw new Error('节点名称不能为空')
  if (new Set(finalNames).size !== finalNames.length) throw new Error('改名后存在重复节点名称，请调整规则')
  if (renames.some(({ from, to }) => from !== to.trim() && groupNames.has(to.trim()))) throw new Error('新名称与现有策略组重名')

  for (const item of proxies.items) {
    if (!isMap(item)) continue
    const oldName = proxyNodeName(item)
    const newName = renameMap.get(oldName)
    if (newName != null && newName !== oldName) item.set('name', newName)
  }

  const groups = doc.get('proxy-groups', true)
  if (isSeq(groups)) {
    for (const group of groups.items) {
      if (!isMap(group)) continue
      const refs = group.get('proxies', true)
      if (!isSeq(refs)) continue
      for (const ref of refs.items) {
        if (!(ref instanceof Scalar)) continue
        const next = renameMap.get(String(ref.value))
        if (next != null) ref.value = next
      }
    }
  }
  syncDialerProxyTargets(doc, renameMap)
  syncRuleTargets(doc, renameMap)
  return doc.toString({ lineWidth: 0 })
}

/** Delete nodes and remove their now-invalid inline proxy-group references. */
export function deleteProxyNodes(source: string, names: string[]): string {
  const { doc, proxies } = editableProxySequence(source)
  const removed = new Set(names)
  let foundDependent = true
  while (foundDependent) {
    foundDependent = false
    for (const item of proxies.items) {
      if (!isMap(item)) continue
      const name = proxyNodeName(item)
      const dialer = scalarValue(item.get('dialer-proxy', true))
      if (name && typeof dialer === 'string' && removed.has(dialer) && !removed.has(name)) {
        removed.add(name)
        foundDependent = true
      }
    }
  }
  proxies.items = proxies.items.filter((item) => !removed.has(proxyNodeName(item)))

  const groups = doc.get('proxy-groups', true)
  if (isSeq(groups)) {
    for (const group of groups.items) {
      if (!isMap(group)) continue
      const refs = group.get('proxies', true)
      if (isSeq(refs)) refs.items = refs.items.filter((ref) => !removed.has(String(scalarValue(ref))))
    }
  }
  removeRulesTargeting(doc, removed)
  return doc.toString({ lineWidth: 0 })
}

/** Rename a strategy group and update nested group references plus routing rule targets. */
export function renameProxyGroup(source: string, from: string, to: string): string {
  const nextName = to.trim()
  if (!nextName) throw new Error('策略组名称不能为空')
  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors[0].message)
  if (!isMap(doc.contents)) throw new Error('YAML 顶层必须是一个对象')
  const groups = doc.get('proxy-groups', true)
  if (!isSeq(groups)) throw new Error('proxy-groups 必须是列表')

  const plain = doc.toJS() as Record<string, unknown>
  const nodeNames = new Set(asObjectArray(plain.proxies).map((node) => String(node.name ?? '')))
  const groupNames = new Set(asObjectArray(plain['proxy-groups']).map((group) => String(group.name ?? '')))
  if (nextName !== from && (nodeNames.has(nextName) || groupNames.has(nextName))) throw new Error('新名称与现有节点或策略组重名')

  let target: YAMLMap | undefined
  for (const group of groups.items) {
    if (isMap(group) && String(scalarValue(group.get('name', true)) ?? '') === from) {
      target = group
      break
    }
  }
  if (!target) throw new Error(`找不到策略组：${from}`)
  target.set('name', nextName)

  for (const group of groups.items) {
    if (!isMap(group)) continue
    const refs = group.get('proxies', true)
    if (!isSeq(refs)) continue
    for (const ref of refs.items) if (ref instanceof Scalar && String(ref.value) === from) ref.value = nextName
  }
  syncDialerProxyTargets(doc, new Map([[from, nextName]]))
  syncRuleTargets(doc, new Map([[from, nextName]]))
  return doc.toString({ lineWidth: 0 })
}

/** Find routing rules whose final policy target points directly to a node or strategy group. */
export function findRuleReferences(source: string, targetName: string): RuleReference[] {
  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors[0].message)
  const result: RuleReference[] = []
  for (const { section, rules } of namedRuleSequences(doc)) {
    rules.items.forEach((item, index) => {
      if (!(item instanceof Scalar) || typeof item.value !== 'string') return
      const target = ruleTarget(item.value)
      if (target?.value === targetName) result.push({ id: `${section}:${index}`, section, index, text: item.value })
    })
  }
  return result
}

/** Delete a strategy group, moving selected rule targets and every nested-group reference to a replacement. */
export function deleteProxyGroup(source: string, groupName: string, replacementName: string | undefined, transferredRuleIds: string[]): string {
  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors[0].message)
  if (!isMap(doc.contents)) throw new Error('YAML 顶层必须是一个对象')
  const groups = doc.get('proxy-groups', true)
  if (!isSeq(groups)) throw new Error('proxy-groups 必须是列表')

  const groupNames = new Set(groups.items.map((group) => isMap(group) ? String(scalarValue(group.get('name', true)) ?? '') : ''))
  if (!groupNames.has(groupName)) throw new Error(`找不到策略组：${groupName}`)
  if (replacementName && ((!groupNames.has(replacementName) && !RULE_SPECIAL_TARGETS.has(replacementName)) || replacementName === groupName)) throw new Error('请选择其他有效策略组或特殊策略作为迁移目标')
  const nestedReplacement = replacementName && (groupNames.has(replacementName) || GROUP_SPECIAL_TARGETS.has(replacementName)) ? replacementName : undefined

  groups.items = groups.items.filter((group) => !isMap(group) || String(scalarValue(group.get('name', true)) ?? '') !== groupName)
  for (const group of groups.items) {
    if (!isMap(group)) continue
    const ownerName = String(scalarValue(group.get('name', true)) ?? '')
    const refs = group.get('proxies', true)
    if (!isSeq(refs)) continue
    const nextItems = []
    for (const ref of refs.items) {
      if (!(ref instanceof Scalar) || String(ref.value) !== groupName) {
        nextItems.push(ref)
      } else if (nestedReplacement && ownerName !== nestedReplacement) {
        ref.value = nestedReplacement
        nextItems.push(ref)
      }
    }
    refs.items = nextItems
  }

  const proxies = doc.get('proxies', true)
  if (isSeq(proxies)) {
    for (const node of proxies.items) {
      if (!isMap(node) || scalarValue(node.get('dialer-proxy', true)) !== groupName) continue
      if (nestedReplacement) node.set('dialer-proxy', nestedReplacement)
      else node.delete('dialer-proxy')
    }
  }

  const transferred = new Set(transferredRuleIds)
  for (const { section, rules } of namedRuleSequences(doc)) {
    rules.items = rules.items.filter((item, index) => {
      if (!(item instanceof Scalar) || typeof item.value !== 'string') return true
      const target = ruleTarget(item.value)
      if (target?.value !== groupName) return true
      const id = `${section}:${index}`
      if (!replacementName || !transferred.has(id)) return false
      const original = target.parts[target.index]
      const leading = original.match(/^\s*/)?.[0] ?? ''
      const trailing = original.match(/\s*$/)?.[0] ?? ''
      target.parts[target.index] = `${leading}${replacementName}${trailing}`
      item.value = target.parts.join(',')
      return true
    })
  }
  return doc.toString({ lineWidth: 0 })
}

/** Move one YAML proxy item before another while preserving the node mapping itself. */
export function moveProxyNode(source: string, movingName: string, targetName: string): string {
  if (movingName === targetName) return source
  const { doc, proxies } = editableProxySequence(source)
  const from = proxies.items.findIndex((item) => proxyNodeName(item) === movingName)
  if (from < 0) throw new Error(`找不到节点：${movingName}`)
  const [moving] = proxies.items.splice(from, 1)
  const target = proxies.items.findIndex((item) => proxyNodeName(item) === targetName)
  if (target < 0) throw new Error(`找不到节点：${targetName}`)
  proxies.items.splice(target, 0, moving)
  return doc.toString({ lineWidth: 0 })
}

/** Apply an explicit name order; intended for sorted views and future cross-config workspaces. */
export function orderProxyNodes(source: string, orderedNames: string[]): string {
  const { doc, proxies } = editableProxySequence(source)
  const rank = new Map(orderedNames.map((name, index) => [name, index]))
  proxies.items.sort((left, right) => {
    const leftRank = rank.get(proxyNodeName(left)) ?? Number.MAX_SAFE_INTEGER
    const rightRank = rank.get(proxyNodeName(right)) ?? Number.MAX_SAFE_INTEGER
    return leftRank - rightRank
  })
  return doc.toString({ lineWidth: 0 })
}

/** Reorder one or more proxy-group reference lists while retaining scalar comments where possible. */
export function orderProxyGroupReferences(source: string, updates: ProxyGroupOrder[]): string {
  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors[0].message)
  if (!isMap(doc.contents)) throw new Error('YAML 顶层必须是一个对象')
  const groups = doc.get('proxy-groups', true)
  if (!isSeq(groups)) throw new Error('proxy-groups 必须是列表')

  const pending = new Map(updates.map((update) => [update.groupName, update.proxies]))
  const applied = new Set<string>()
  for (const group of groups.items) {
    if (!isMap(group)) continue
    const groupName = String(scalarValue(group.get('name', true)) ?? '')
    const nextOrder = pending.get(groupName)
    if (!nextOrder || applied.has(groupName)) continue
    const refs = group.get('proxies', true)
    if (!isSeq(refs)) throw new Error(`策略组「${groupName}」没有可排序的 proxies 列表`)

    const buckets = new Map<string, typeof refs.items>()
    for (const item of refs.items) {
      const name = String(scalarValue(item))
      const bucket = buckets.get(name) ?? []
      bucket.push(item)
      buckets.set(name, bucket)
    }
    refs.items = nextOrder.map((name) => buckets.get(name)?.shift() ?? new Scalar(name))
    applied.add(groupName)
  }

  const missing = Array.from(pending.keys()).filter((name) => !applied.has(name))
  if (missing.length) throw new Error(`找不到策略组：${missing.join('、')}`)
  return doc.toString({ lineWidth: 0 })
}

/** Copy inline proxy nodes between configs while keeping copied dialer-proxy chains valid. */
export function copyProxyNodes(
  source: string,
  target: string,
  selectedNames: string[],
  strategy: CopyConflictStrategy = 'rename',
): CopyProxyResult {
  if (!selectedNames.length) throw new Error('请先选择需要加入主文件的节点')

  const sourceDoc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  const targetDoc = parseDocument(target, { prettyErrors: true, uniqueKeys: true })
  if (sourceDoc.errors.length) throw new Error(`来源配置：${sourceDoc.errors[0].message}`)
  if (targetDoc.errors.length) throw new Error(`主配置：${targetDoc.errors[0].message}`)
  if (!isMap(sourceDoc.contents) || !isMap(targetDoc.contents)) throw new Error('YAML 顶层必须是一个对象')

  const sourceProxies = sourceDoc.get('proxies', true)
  if (!isSeq(sourceProxies)) throw new Error('来源配置没有可复制的 proxies 列表')
  let targetProxies = targetDoc.get('proxies', true)
  if (targetProxies == null) {
    targetProxies = new YAMLSeq()
    targetDoc.set('proxies', targetProxies)
  }
  if (!isSeq(targetProxies)) throw new Error('主配置的 proxies 必须是列表')

  const sourceByName = new Map<string, YAMLMap>()
  for (const item of sourceProxies.items) {
    const name = proxyNodeName(item)
    if (name && isMap(item) && !sourceByName.has(name)) sourceByName.set(name, item)
  }
  const missing = selectedNames.filter((name) => !sourceByName.has(name))
  if (missing.length) throw new Error(`来源配置找不到节点：${missing.join('、')}`)

  const requested = new Set(selectedNames)
  const included = new Set<string>()
  const includeWithDependencies = (name: string) => {
    if (included.has(name)) return
    const node = sourceByName.get(name)
    if (!node) return
    included.add(name)
    const dialer = scalarValue(node.get('dialer-proxy', true))
    if (typeof dialer === 'string' && sourceByName.has(dialer)) includeWithDependencies(dialer)
  }
  for (const name of selectedNames) includeWithDependencies(name)
  const orderedNames = sourceProxies.items.map(proxyNodeName).filter((name) => included.has(name))

  const targetByName = new Map<string, { node: YAMLMap; index: number; plain: unknown }>()
  targetProxies.items.forEach((item, index) => {
    const name = proxyNodeName(item)
    if (name && isMap(item) && !targetByName.has(name)) targetByName.set(name, { node: item, index, plain: item.toJSON() })
  })
  const targetGroups = targetDoc.get('proxy-groups', true)
  const groupNames = new Set(isSeq(targetGroups) ? targetGroups.items.map((item) => isMap(item) ? String(scalarValue(item.get('name', true)) ?? '') : '').filter(Boolean) : [])
  const usedNames = new Set([...targetByName.keys(), ...groupNames])
  const renameMap = new Map<string, string>()
  const actions = new Map<string, 'append' | 'replace' | 'skip'>()
  const skippedNames: string[] = []
  const renamed: NodeRename[] = []
  let conflictCount = 0

  for (const name of orderedNames) {
    const sourceNode = sourceByName.get(name)!
    const existing = targetByName.get(name)
    if (existing && JSON.stringify(existing.plain) === JSON.stringify(sourceNode.toJSON())) {
      renameMap.set(name, name)
      actions.set(name, 'skip')
      skippedNames.push(name)
      continue
    }
    if (existing || groupNames.has(name)) {
      conflictCount += 1
      if (strategy === 'skip') {
        renameMap.set(name, name)
        actions.set(name, 'skip')
        skippedNames.push(name)
        continue
      }
      if (strategy === 'replace' && existing) {
        renameMap.set(name, name)
        actions.set(name, 'replace')
        continue
      }
      const nextName = uniqueCopiedName(name, usedNames)
      renameMap.set(name, nextName)
      renamed.push({ from: name, to: nextName })
      actions.set(name, 'append')
      continue
    }
    usedNames.add(name)
    renameMap.set(name, name)
    actions.set(name, 'append')
  }

  const copiedNames: string[] = []
  for (const name of orderedNames) {
    const action = actions.get(name)
    if (!action || action === 'skip') continue
    const clone = sourceByName.get(name)!.clone(targetDoc.schema) as YAMLMap
    const nextName = renameMap.get(name) ?? name
    clone.set('name', nextName)
    const dialer = scalarValue(clone.get('dialer-proxy', true))
    if (typeof dialer === 'string' && renameMap.has(dialer)) clone.set('dialer-proxy', renameMap.get(dialer)!)
    if (action === 'replace') {
      const existing = targetByName.get(name)
      if (existing) targetProxies.items[existing.index] = clone
    } else {
      targetProxies.add(clone)
    }
    copiedNames.push(nextName)
  }

  return {
    yaml: targetDoc.toString({ lineWidth: 0 }),
    copiedNames,
    skippedNames,
    renamed,
    dependencyCount: Math.max(0, included.size - requested.size),
    conflictCount,
  }
}

export function buildConfig(source: string, selectedNames: string[], settings: ExitSettings): BuildResult {
  const settingErrors = validateSettings(settings)
  if (settingErrors.length) throw new Error(settingErrors[0])
  if (!selectedNames.length) throw new Error('请至少选择一个机场节点')

  const doc = parseDocument(source, { prettyErrors: true, uniqueKeys: true })
  if (doc.errors.length) throw new Error(doc.errors[0].message)
  if (!isMap(doc.contents)) throw new Error('YAML 顶层必须是一个对象')

  let proxiesNode = doc.get('proxies', true)
  if (proxiesNode == null) {
    proxiesNode = new YAMLSeq()
    doc.set('proxies', proxiesNode)
  }
  if (!isSeq(proxiesNode)) throw new Error('proxies 必须是列表')

  const plain = doc.toJS() as Record<string, unknown>
  const sourceProxies = asObjectArray(plain.proxies) as ProxyNode[]
  const sourceNames = new Set(sourceProxies.map((node) => String(node.name ?? '')))
  const missing = selectedNames.filter((name) => !sourceNames.has(name))
  if (missing.length) throw new Error(`找不到节点：${missing.join('、')}`)

  const usedNames = new Set(sourceNames)
  const generated = selectedNames.map((dialer) => {
    const wanted = formatName(settings.nameTemplate, dialer, settings.label)
    const name = uniqueName(wanted || `${dialer} · ${settings.label}`, usedNames)
    const proxy = createExitNode(name, dialer, settings)
    proxiesNode.add(proxy)
    return { name, dialer }
  })

  let groupsNode = doc.get('proxy-groups', true)
  if ((settings.createGroup || settings.syncSourceGroups) && groupsNode == null) {
    groupsNode = new YAMLSeq()
    doc.set('proxy-groups', groupsNode)
  }
  if ((settings.createGroup || settings.syncSourceGroups) && !isSeq(groupsNode)) throw new Error('proxy-groups 必须是列表')

  const warnings: string[] = []
  if (isSeq(groupsNode)) {
    if (settings.createGroup) {
      let targetGroup: YAMLMap | undefined
      for (const item of groupsNode.items) {
        if (isMap(item) && scalarValue(mapGet(item, 'name')) === settings.groupName.trim()) {
          targetGroup = item
          break
        }
      }
      if (targetGroup) {
        let refs: unknown = targetGroup.get('proxies', true)
        if (refs == null) {
          refs = new YAMLSeq()
          targetGroup.set('proxies', refs)
        }
        if (!isSeq(refs)) throw new Error(`策略组「${settings.groupName}」的 proxies 不是列表`)
        const existing = new Set(refs.items.map((item) => String(scalarValue(item))))
        for (const item of generated) if (!existing.has(item.name)) refs.add(item.name)
      } else {
        groupsNode.add({ name: settings.groupName.trim(), type: 'select', proxies: generated.map((item) => item.name) })
      }
    }

    if (settings.syncSourceGroups) {
      let synced = 0
      for (const groupNode of groupsNode.items) {
        if (!isMap(groupNode)) continue
        const refs = groupNode.get('proxies', true)
        if (!isSeq(refs)) continue
        const refNames = new Set(refs.items.map((item) => String(scalarValue(item))))
        for (const item of generated) {
          if (refNames.has(item.dialer) && !refNames.has(item.name)) {
            refs.add(item.name)
            refNames.add(item.name)
            synced += 1
          }
        }
      }
      if (!synced) warnings.push('所选节点未出现在任何内联策略组中，因此没有同步策略组')
    }
  }

  return { yaml: doc.toString({ lineWidth: 0 }), generatedNames: generated.map((item) => item.name), warnings }
}

export const SAMPLE_YAML = `# Mihomo / Meta 配置示例
mixed-port: 7890
allow-lan: false
mode: rule

proxies:
  - name: 香港 01
    type: ss
    server: hk.example.com
    port: 443
    cipher: aes-128-gcm
    password: example
    udp: true
  - name: 新加坡 01
    type: trojan
    server: sg.example.com
    port: 443
    password: example
    sni: sg.example.com

proxy-groups:
  - name: 节点选择
    type: select
    proxies:
      - 香港 01
      - 新加坡 01
      - DIRECT

rules:
  - MATCH,节点选择
`
