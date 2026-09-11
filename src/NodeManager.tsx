import { useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  CircleAlert,
  Filter,
  GripVertical,
  Layers3,
  Pencil,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  deleteProxyNodes,
  moveProxyNode,
  orderProxyNodes,
  parseConfig,
  renameProxyNodes,
  type NodeRename,
  type ProxyNode,
} from './core'

export type SelectionMode = 'single' | 'multiple'
type SortMode = 'manual' | 'name-asc' | 'name-desc' | 'type' | 'server'

type NodeManagerProps = {
  configId: string
  source: string
  nodes: ProxyNode[]
  selected: Set<string>
  mode: SelectionMode
  onModeChange: (mode: SelectionMode) => void
  onSelectionChange: (selected: Set<string>) => void
  onSourceChange: (source: string, message: string) => void
}

type RenameState = {
  names: string[]
  singleName: string
  prefix: string
  suffix: string
  find: string
  replace: string
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function protocolLabel(type?: string) {
  if (!type) return '未知'
  const normalized = type.toLowerCase()
  const labels: Record<string, string> = {
    ss: 'SS', shadowsocks: 'SS', trojan: 'Trojan', vmess: 'VMess', vless: 'VLESS',
    hysteria2: 'HY2', hy2: 'HY2', tuic: 'TUIC', wireguard: 'WG', socks5: 'SOCKS5', http: 'HTTP',
  }
  return labels[normalized] ?? type.toUpperCase()
}

function protocolTone(type?: string) {
  const normalized = type?.toLowerCase()
  if (normalized === 'trojan' || normalized === 'vless') return 'violet'
  if (normalized === 'hysteria2' || normalized === 'hy2' || normalized === 'tuic') return 'amber'
  return 'blue'
}

function sortedNodes(nodes: ProxyNode[], sort: SortMode) {
  const result = [...nodes]
  if (sort === 'manual') return result
  result.sort((left, right) => {
    if (sort === 'name-desc') return collator.compare(right.name, left.name)
    if (sort === 'type') return collator.compare(String(left.type ?? ''), String(right.type ?? '')) || collator.compare(left.name, right.name)
    if (sort === 'server') return collator.compare(String(left.server ?? ''), String(right.server ?? '')) || collator.compare(left.name, right.name)
    return collator.compare(left.name, right.name)
  })
  return result
}

function NodeCard({
  node,
  selected,
  draggable,
  onToggle,
  onRename,
  onDelete,
  onDragStart,
  onDrop,
}: {
  node: ProxyNode
  selected: boolean
  draggable: boolean
  onToggle: (shiftKey: boolean) => void
  onRename: () => void
  onDelete: () => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}) {
  const stop = (event: MouseEvent) => event.stopPropagation()
  return (
    <div
      className={`node-card ${selected ? 'selected' : ''} ${draggable ? 'draggable' : ''}`}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onClick={(event) => onToggle(event.shiftKey)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onToggle(false) }}
      onDragStart={onDragStart}
      onDragOver={(event) => { if (draggable) event.preventDefault() }}
      onDrop={onDrop}
    >
      <span className="drag-handle" title={draggable ? '拖拽调整 YAML 中的节点顺序' : '切换到手动顺序后可拖拽'}><GripVertical size={15} /></span>
      <span className={`node-check ${selected ? 'checked' : ''}`}>{selected && <Check size={13} strokeWidth={3} />}</span>
      <span className="node-main">
        <strong>{node.name}</strong>
        <span>{node.server ? `${node.server}${node.port ? `:${node.port}` : ''}` : '未填写服务器地址'}</span>
      </span>
      <span className={`protocol ${protocolTone(node.type)}`}>{protocolLabel(node.type)}</span>
      <span className="node-actions" onClick={stop}>
        <button type="button" onClick={onRename} title="改名" aria-label={`修改 ${node.name} 的名称`}><Pencil size={13} /></button>
        <button type="button" className="danger" onClick={onDelete} title="删除" aria-label={`删除 ${node.name}`}><Trash2 size={13} /></button>
      </span>
    </div>
  )
}

export default function NodeManager({
  configId,
  source,
  nodes,
  selected,
  mode,
  onModeChange,
  onSelectionChange,
  onSourceChange,
}: NodeManagerProps) {
  const [query, setQuery] = useState('')
  const [serverQuery, setServerQuery] = useState('')
  const [protocols, setProtocols] = useState<Set<string>>(new Set())
  const [portMin, setPortMin] = useState('')
  const [portMax, setPortMax] = useState('')
  const [requireUdp, setRequireUdp] = useState(false)
  const [requireTls, setRequireTls] = useState(false)
  const [requireDialer, setRequireDialer] = useState(false)
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState<SortMode>('manual')
  const [dragging, setDragging] = useState('')
  const [selectionAnchor, setSelectionAnchor] = useState('')
  const [rename, setRename] = useState<RenameState | null>(null)
  const [renameError, setRenameError] = useState('')

  const availableProtocols = useMemo(() => Array.from(new Set(nodes.map((node) => String(node.type ?? '未知')))).sort(collator.compare), [nodes])
  const activeFilterCount = protocols.size + Number(!!serverQuery) + Number(!!portMin || !!portMax) + Number(requireUdp) + Number(requireTls) + Number(requireDialer) + Number(selectedOnly)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const server = serverQuery.trim().toLowerCase()
    const min = portMin ? Number(portMin) : undefined
    const max = portMax ? Number(portMax) : undefined
    const matches = nodes.filter((node) => {
      const port = Number(node.port)
      if (keyword && !`${node.name} ${node.type ?? ''} ${node.server ?? ''}`.toLowerCase().includes(keyword)) return false
      if (server && !String(node.server ?? '').toLowerCase().includes(server)) return false
      if (protocols.size && !protocols.has(String(node.type ?? '未知'))) return false
      if (min != null && (!Number.isFinite(port) || port < min)) return false
      if (max != null && (!Number.isFinite(port) || port > max)) return false
      if (requireUdp && node.udp !== true) return false
      if (requireTls && node.tls !== true) return false
      if (requireDialer && typeof node['dialer-proxy'] !== 'string') return false
      if (selectedOnly && !selected.has(node.name)) return false
      return true
    })
    return sortedNodes(matches, sort)
  }, [nodes, portMax, portMin, protocols, query, requireDialer, requireTls, requireUdp, selected, selectedOnly, serverQuery, sort])

  const toggleNode = (name: string, shiftKey = false) => {
    if (mode === 'single') {
      onSelectionChange(new Set(selected.has(name) ? [] : [name]))
      setSelectionAnchor(name)
      return
    }
    if (shiftKey && selectionAnchor) {
      const anchorIndex = filtered.findIndex((node) => node.name === selectionAnchor)
      const targetIndex = filtered.findIndex((node) => node.name === name)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        onSelectionChange(new Set([...selected, ...filtered.slice(start, end + 1).map((node) => node.name)]))
        return
      }
    }
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onSelectionChange(next)
    setSelectionAnchor(name)
  }

  const openRename = (names: string[]) => {
    if (!names.length) return
    setRename({ names, singleName: names[0], prefix: '', suffix: '', find: '', replace: '' })
    setRenameError('')
  }

  const applyRename = () => {
    if (!rename) return
    const changes: NodeRename[] = rename.names.map((name) => ({
      from: name,
      to: rename.names.length === 1 ? rename.singleName : `${rename.prefix}${rename.find ? name.replaceAll(rename.find, rename.replace) : name}${rename.suffix}`,
    }))
    if (changes.every(({ from, to }) => from === to.trim())) {
      setRenameError('名称没有发生变化')
      return
    }
    try {
      const nextSource = renameProxyNodes(source, changes)
      const renamed = new Map(changes.map(({ from, to }) => [from, to.trim()]))
      onSelectionChange(new Set(Array.from(selected, (name) => renamed.get(name) ?? name)))
      onSourceChange(nextSource, `已修改 ${changes.length} 个节点名称，并同步出口链、策略组及规则引用`)
      setRename(null)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : '节点改名失败')
    }
  }

  const removeNodes = (names: string[]) => {
    if (!names.length || !window.confirm(`确定删除 ${names.length} 个节点？对应的出口链依赖节点、策略组引用及直接规则也会一并清理。`)) return
    try {
      const nextSource = deleteProxyNodes(source, names)
      const remainingNames = new Set(parseConfig(nextSource).proxies.map((node) => node.name))
      const removedCount = nodes.length - remainingNames.size
      const dependentCount = Math.max(0, removedCount - names.length)
      onSourceChange(nextSource, `已删除 ${removedCount} 个节点${dependentCount ? `，其中 ${dependentCount} 个为出口链依赖节点` : ''}`)
      onSelectionChange(new Set(Array.from(selected).filter((name) => remainingNames.has(name))))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除失败')
    }
  }

  const dropNode = (targetName: string) => {
    if (!dragging || dragging === targetName || sort !== 'manual') return
    try {
      onSourceChange(moveProxyNode(source, dragging, targetName), '已更新节点顺序')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '排序失败')
    } finally {
      setDragging('')
    }
  }

  const applySortedOrder = () => {
    if (sort === 'manual') return
    const ordered = sortedNodes(nodes, sort).map((node) => node.name)
    onSourceChange(orderProxyNodes(source, ordered), '已将当前排序写入 YAML')
    setSort('manual')
  }

  const clearFilters = () => {
    setServerQuery(''); setPortMin(''); setPortMax(''); setProtocols(new Set())
    setRequireUdp(false); setRequireTls(false); setRequireDialer(false); setSelectedOnly(false)
  }

  const visibleNames = filtered.map((node) => node.name)
  const allVisibleSelected = visibleNames.length > 0 && visibleNames.every((name) => selected.has(name))

  return (
    <section className="panel nodes-panel node-manager" data-config-id={configId}>
      <div className="panel-heading node-manager-heading">
        <div><span className="section-no">02</span><div><h2>节点编辑与选择</h2><p>卡片管理、批量操作与顺序编排</p></div></div>
        <div className="mode-switch" role="group" aria-label="选择模式">
          <button className={mode === 'single' ? 'active' : ''} onClick={() => onModeChange('single')}><Pencil size={14} /> 单选</button>
          <button className={mode === 'multiple' ? 'active' : ''} onClick={() => onModeChange('multiple')}><Users size={14} /> 多选</button>
        </div>
      </div>

      <div className="node-toolbar">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、协议或地址" />{query && <button onClick={() => setQuery('')}><X size={14} /></button>}</label>
        <button type="button" className={`filter-button ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}><Filter size={15} /> 筛选{activeFilterCount > 0 && <b>{activeFilterCount}</b>}<ChevronDown size={14} className={showFilters ? 'rotated' : ''} /></button>
        {mode === 'multiple' && <button type="button" className="select-all" onClick={() => onSelectionChange(allVisibleSelected ? new Set(Array.from(selected).filter((name) => !visibleNames.includes(name))) : new Set([...selected, ...visibleNames]))}>{allVisibleSelected ? '取消可见' : '全选可见'}</button>}
      </div>

      {showFilters && <div className="filter-panel">
        <div className="filter-row wide"><span>协议</span><div className="filter-chips">{availableProtocols.map((protocol) => <button type="button" className={protocols.has(protocol) ? 'active' : ''} key={protocol} onClick={() => { const next = new Set(protocols); if (next.has(protocol)) next.delete(protocol); else next.add(protocol); setProtocols(next) }}>{protocolLabel(protocol)}</button>)}</div></div>
        <label><span>服务器包含</span><input value={serverQuery} onChange={(event) => setServerQuery(event.target.value)} placeholder="域名或 IP" /></label>
        <div className="port-range"><label><span>最低端口</span><input type="number" min="1" max="65535" value={portMin} onChange={(event) => setPortMin(event.target.value)} /></label><i>—</i><label><span>最高端口</span><input type="number" min="1" max="65535" value={portMax} onChange={(event) => setPortMax(event.target.value)} /></label></div>
        <div className="filter-toggles wide">
          <button className={requireUdp ? 'active' : ''} onClick={() => setRequireUdp(!requireUdp)}>UDP</button>
          <button className={requireTls ? 'active' : ''} onClick={() => setRequireTls(!requireTls)}>TLS</button>
          <button className={requireDialer ? 'active' : ''} onClick={() => setRequireDialer(!requireDialer)}>已有出口链</button>
          <button className={selectedOnly ? 'active' : ''} onClick={() => setSelectedOnly(!selectedOnly)}>仅已选</button>
          {activeFilterCount > 0 && <button className="clear-filter" onClick={clearFilters}>清空条件</button>}
        </div>
      </div>}

      <div className="sort-bar">
        <span><SlidersHorizontal size={14} /> 显示 {filtered.length} / {nodes.length}</span>
        <label><ArrowDownAZ size={14} /><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="manual">手动顺序</option><option value="name-asc">名称 A → Z</option><option value="name-desc">名称 Z → A</option><option value="type">按协议</option><option value="server">按服务器</option></select></label>
        {sort !== 'manual' && <button type="button" className="apply-sort" onClick={applySortedOrder}>应用到 YAML</button>}
      </div>

      <div className="node-list editor-node-list">
        {filtered.map((node) => <NodeCard
          key={node.name}
          node={node}
          selected={selected.has(node.name)}
          draggable={sort === 'manual'}
          onToggle={(shiftKey) => toggleNode(node.name, shiftKey)}
          onRename={() => openRename([node.name])}
          onDelete={() => removeNodes([node.name])}
          onDragStart={(event) => { setDragging(node.name); event.dataTransfer.effectAllowed = 'move' }}
          onDrop={(event) => { event.preventDefault(); dropNode(node.name) }}
        />)}
        {!filtered.length && <div className="empty-state"><Search size={25} /><strong>没有匹配的节点</strong><span>调整筛选条件后再试</span></div>}
      </div>

      <div className="batch-bar">
        <span><Layers3 size={15} /> 已选 <strong>{selected.size}</strong> 个</span>
        <button type="button" disabled={!selected.size} onClick={() => openRename(Array.from(selected))}><Pencil size={13} /> 批量改名</button>
        <button type="button" className="danger" disabled={!selected.size} onClick={() => removeNodes(Array.from(selected))}><Trash2 size={13} /> 批量删除</button>
        {selected.size > 0 && <button type="button" className="clear-selection" onClick={() => onSelectionChange(new Set())}>清空选择</button>}
      </div>

      {rename && <div className="editor-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRename(null) }}>
        <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="rename-title">
          <button type="button" className="editor-modal-close" onClick={() => setRename(null)} aria-label="关闭"><X size={17} /></button>
          <div className="editor-modal-heading"><span><Pencil size={18} /></span><div><h3 id="rename-title">{rename.names.length === 1 ? '节点改名' : `批量修改 ${rename.names.length} 个名称`}</h3><p>改名后会自动同步 proxy-groups 中的引用</p></div></div>
          {rename.names.length === 1 ? <label className="rename-field"><span>新名称</span><input autoFocus value={rename.singleName} onChange={(event) => setRename({ ...rename, singleName: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') applyRename() }} /></label> : <>
            <div className="rename-grid"><label className="rename-field"><span>添加前缀</span><input value={rename.prefix} onChange={(event) => setRename({ ...rename, prefix: event.target.value })} placeholder="例如：自用-" /></label><label className="rename-field"><span>添加后缀</span><input value={rename.suffix} onChange={(event) => setRename({ ...rename, suffix: event.target.value })} placeholder="例如：-01" /></label><label className="rename-field"><span>查找文字</span><input value={rename.find} onChange={(event) => setRename({ ...rename, find: event.target.value })} placeholder="留空则不替换" /></label><label className="rename-field"><span>替换为</span><input value={rename.replace} onChange={(event) => setRename({ ...rename, replace: event.target.value })} /></label></div>
            <div className="rename-preview"><strong>预览</strong>{rename.names.slice(0, 4).map((name) => <span key={name}>{name}<b>→</b>{rename.prefix}{rename.find ? name.replaceAll(rename.find, rename.replace) : name}{rename.suffix}</span>)}{rename.names.length > 4 && <small>另有 {rename.names.length - 4} 个节点</small>}</div>
          </>}
          {renameError && <div className="rename-error"><CircleAlert size={14} />{renameError}</div>}
          <div className="editor-modal-actions"><button type="button" onClick={() => setRename(null)}>取消</button><button type="button" className="primary" onClick={applyRename}>确认改名</button></div>
        </section>
      </div>}
    </section>
  )
}
