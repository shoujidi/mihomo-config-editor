import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ArrowRight, ArrowRightLeft, Check, CircleAlert, Clipboard, Crown, Download, FileCode2, FilePlus2,
  Columns2, FileUp, Files, GripVertical, History, Layers3, Maximize2, Minimize2, PencilRuler, QrCode,
  Redo2, RotateCcw, Search, ShieldCheck, Undo2, X,
} from 'lucide-react'
import NodeManager, { type SelectionMode } from './NodeManager'
import GroupManager from './GroupManager'
import RefreshDialog from './RefreshDialog'
import { copyProxyNodes, parseConfig, type CopyConflictStrategy, type ParsedConfig, type ProxyNode } from './core'

type ConfigEditorProps = {
  onFlash: (message: string) => void
  incoming?: { id: number; source: string; filename: string }
  onSendToBuilder: (source: string, filename: string) => void
  onShareYaml: (source: string, filename: string) => void
}

type ConfigDocument = {
  id: string
  filename: string
  source: string
  history: string[]
  historyIndex: number
  selected: Set<string>
  mode: SelectionMode
}

type ParsedDocument = { data: ParsedConfig | null; error: string }
type TransferSort = 'manual' | 'name' | 'type' | 'server'
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function createDocument(source: string, filename: string): ConfigDocument {
  return { id: `config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, filename, source, history: [source], historyIndex: 0, selected: new Set(), mode: 'multiple' }
}

function protocolLabel(type?: string) {
  if (!type) return '未知'
  const normalized = type.toLowerCase()
  const labels: Record<string, string> = { ss: 'SS', shadowsocks: 'SS', trojan: 'Trojan', vmess: 'VMess', vless: 'VLESS', hysteria2: 'HY2', hy2: 'HY2', tuic: 'TUIC', wireguard: 'WG', socks5: 'SOCKS5', http: 'HTTP' }
  return labels[normalized] ?? type.toUpperCase()
}

function parseDocumentSource(source: string): ParsedDocument {
  try { return { data: parseConfig(source), error: '' } }
  catch (error) { return { data: null, error: error instanceof Error ? error.message : 'YAML 解析失败' } }
}

export default function ConfigEditor({ onFlash, incoming, onSendToBuilder, onShareYaml }: ConfigEditorProps) {
  const [documents, setDocuments] = useState<ConfigDocument[]>([])
  const [activeId, setActiveId] = useState('')
  const [refreshId, setRefreshId] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [workspace, setWorkspace] = useState<'nodes' | 'groups'>('nodes')
  const [focusMode, setFocusMode] = useState(false)
  const [transferMode, setTransferMode] = useState(false)
  const [splitMode, setSplitMode] = useState(false)
  const [splitReversed, setSplitReversed] = useState(false)
  const [splitSelections, setSplitSelections] = useState<Record<string, Set<string>>>({})
  const [splitAnchors, setSplitAnchors] = useState<Record<string, string>>({})
  const [splitQueries, setSplitQueries] = useState<Record<string, string>>({})
  const [splitProtocols, setSplitProtocols] = useState<Record<string, string>>({})
  const [splitDragging, setSplitDragging] = useState<{ sourceId: string; names: string[] } | null>(null)
  const [splitDropTarget, setSplitDropTarget] = useState('')
  const [mainId, setMainId] = useState('')
  const [transferSourceId, setTransferSourceId] = useState('')
  const [transferSelections, setTransferSelections] = useState<Record<string, Set<string>>>({})
  const [transferAnchors, setTransferAnchors] = useState<Record<string, string>>({})
  const [transferQuery, setTransferQuery] = useState('')
  const [transferProtocol, setTransferProtocol] = useState('')
  const [transferSort, setTransferSort] = useState<TransferSort>('manual')
  const [mainQuery, setMainQuery] = useState('')
  const [conflictStrategy, setConflictStrategy] = useState<CopyConflictStrategy>('rename')
  const fileInput = useRef<HTMLInputElement>(null)

  const parsedDocuments = useMemo(() => {
    const result = new Map<string, ParsedDocument>()
    for (const document of documents) result.set(document.id, parseDocumentSource(document.source))
    return result
  }, [documents])
  const active = documents.find((document) => document.id === activeId) ?? documents[0]
  const parsed = active ? parsedDocuments.get(active.id) ?? { data: null, error: '' } : { data: null, error: '' }
  const loaded = documents.length > 0

  useEffect(() => {
    if (!incoming) return
    if (documents.length >= 2) { onFlash('最多同时打开 2 个配置，请先关闭一个配置'); return }
    try {
      parseConfig(incoming.source)
      const next = createDocument(incoming.source, incoming.filename)
      setDocuments((current) => [...current, next])
      setActiveId(next.id)
      setMainId((current) => current || next.id)
      setShowSource(false); setWorkspace('nodes')
      onFlash(`已接收 ${incoming.filename}，可以继续编辑`)
    } catch (error) { onFlash(error instanceof Error ? error.message : '传入的 YAML 无法解析') }
  }, [incoming?.id])

  useEffect(() => {
    if (!focusMode) return
    const leaveFocus = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocusMode(false) }
    window.addEventListener('keydown', leaveFocus)
    return () => window.removeEventListener('keydown', leaveFocus)
  }, [focusMode])

  const loadFiles = async (files?: FileList | File[]) => {
    const candidates = Array.from(files ?? [])
    if (!candidates.length) return
    const remaining = 2 - documents.length
    if (remaining <= 0) { onFlash('最多同时打开 2 个配置，请先关闭一个配置'); return }
    const accepted: ConfigDocument[] = []
    for (const file of candidates.slice(0, remaining)) {
      if (!/\.ya?ml$/i.test(file.name)) { onFlash(`${file.name} 不是 YAML 配置文件`); continue }
      const text = await file.text()
      try { parseConfig(text); accepted.push(createDocument(text, file.name)) }
      catch (error) { onFlash(`${file.name}：${error instanceof Error ? error.message : 'YAML 解析失败'}`) }
    }
    if (!accepted.length) return
    setDocuments((current) => [...current, ...accepted])
    setActiveId(accepted[0].id)
    setMainId((current) => current || accepted[0].id)
    setShowSource(false); setWorkspace('nodes')
    onFlash(candidates.length > remaining ? '已达到 2 个配置上限，其余文件未载入' : `已载入 ${accepted.length} 个配置`)
    if (fileInput.current) fileInput.current.value = ''
  }

  const commitSource = (id: string, nextSource: string, message: string) => {
    setDocuments((current) => current.map((document) => {
      if (document.id !== id || document.source === nextSource) return document
      const nextHistory = [...document.history.slice(0, document.historyIndex + 1), nextSource].slice(-60)
      return { ...document, source: nextSource, history: nextHistory, historyIndex: nextHistory.length - 1 }
    }))
    onFlash(message)
  }

  const travelHistory = (document: ConfigDocument, nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= document.history.length) return
    setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, source: item.history[nextIndex], historyIndex: nextIndex, selected: new Set() } : item))
    onFlash(nextIndex < document.historyIndex ? '已撤销上一步操作' : '已恢复下一步操作')
  }

  const updateSelection = (id: string, selected: Set<string>) => setDocuments((current) => current.map((document) => document.id === id ? { ...document, selected } : document))
  const updateMode = (id: string, mode: SelectionMode) => setDocuments((current) => current.map((document) => {
    if (document.id !== id) return document
    const selected = mode === 'single' && document.selected.size > 1 ? new Set([Array.from(document.selected)[0]]) : document.selected
    return { ...document, mode, selected }
  }))

  const closeDocument = (id: string) => {
    const target = documents.find((document) => document.id === id)
    if (!target || !window.confirm(`关闭「${target.filename}」？尚未下载的编辑结果将不会保留。`)) return
    const remaining = documents.filter((document) => document.id !== id)
    setDocuments(remaining)
    setTransferSelections((current) => { const next = { ...current }; delete next[id]; return next })
    if (activeId === id) setActiveId(remaining[0]?.id ?? '')
    if (mainId === id) setMainId(remaining[0]?.id ?? '')
    if (transferSourceId === id) setTransferSourceId(remaining.find((document) => document.id !== mainId)?.id ?? '')
    if (remaining.length < 2) setTransferMode(false)
    if (remaining.length < 2) setSplitMode(false)
    if (!remaining.length) setFocusMode(false)
  }

  const copyYaml = async () => { if (active) { await navigator.clipboard.writeText(active.source); onFlash('编辑后的 YAML 已复制') } }
  const editedFilename = active ? `${active.filename.replace(/\.ya?ml$/i, '') || 'config'}-已编辑.yaml` : 'config-已编辑.yaml'
  const downloadYaml = () => {
    if (!active) return
    const url = URL.createObjectURL(new Blob([active.source], { type: 'text/yaml;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = editedFilename; anchor.click(); URL.revokeObjectURL(url)
    onFlash('编辑后的配置已下载')
  }

  const startTransferMode = () => {
    if (documents.length < 2) { onFlash('请至少打开 2 个配置文件'); return }
    const nextMainId = documents.some((document) => document.id === mainId) ? mainId : active?.id || documents[0].id
    setMainId(nextMainId); setTransferSourceId(documents.find((document) => document.id !== nextMainId)?.id ?? '')
    setSplitMode(false); setTransferMode(true); setFocusMode(true); setWorkspace('nodes')
  }
  const startSplitMode = () => {
    if (documents.length !== 2) { onFlash('左右拖拽模式需要正好打开 2 个配置文件'); return }
    setTransferMode(false); setSplitMode(true); setFocusMode(true); setWorkspace('nodes')
  }
  const changeMainDocument = (id: string) => {
    setMainId(id); setTransferSourceId(documents.find((document) => document.id !== id)?.id ?? '')
    setTransferQuery(''); setTransferProtocol('')
  }

  const mainDocument = documents.find((document) => document.id === mainId) ?? documents[0]
  const sourceDocuments = documents.filter((document) => document.id !== mainDocument?.id)
  const transferSource = sourceDocuments.find((document) => document.id === transferSourceId) ?? sourceDocuments[0]
  const sourceParsed = transferSource ? parsedDocuments.get(transferSource.id)?.data : null
  const mainParsed = mainDocument ? parsedDocuments.get(mainDocument.id)?.data : null
  const sourceSelection = transferSource ? transferSelections[transferSource.id] ?? new Set<string>() : new Set<string>()
  const transferTotal = sourceDocuments.reduce((sum, document) => sum + (transferSelections[document.id]?.size ?? 0), 0)
  const availableProtocols = useMemo(() => Array.from(new Set((sourceParsed?.proxies ?? []).map((node) => String(node.type ?? '未知')))).sort(collator.compare), [sourceParsed])
  const filteredSourceNodes = useMemo(() => {
    const keyword = transferQuery.trim().toLowerCase()
    const result = (sourceParsed?.proxies ?? []).filter((node) => (!transferProtocol || String(node.type ?? '未知') === transferProtocol) && (!keyword || `${node.name} ${node.type ?? ''} ${node.server ?? ''}`.toLowerCase().includes(keyword)))
    if (transferSort === 'manual') return result
    return [...result].sort((left, right) => transferSort === 'type' ? collator.compare(String(left.type ?? ''), String(right.type ?? '')) || collator.compare(left.name, right.name) : transferSort === 'server' ? collator.compare(String(left.server ?? ''), String(right.server ?? '')) || collator.compare(left.name, right.name) : collator.compare(left.name, right.name))
  }, [sourceParsed, transferProtocol, transferQuery, transferSort])
  const filteredMainNodes = useMemo(() => {
    const keyword = mainQuery.trim().toLowerCase()
    return (mainParsed?.proxies ?? []).filter((node) => !keyword || `${node.name} ${node.type ?? ''} ${node.server ?? ''}`.toLowerCase().includes(keyword))
  }, [mainParsed, mainQuery])

  const setSourceSelection = (next: Set<string>) => { if (transferSource) setTransferSelections((current) => ({ ...current, [transferSource.id]: next })) }
  const toggleTransferNode = (name: string, shiftKey: boolean) => {
    if (!transferSource) return
    const next = new Set(sourceSelection); const anchor = transferAnchors[transferSource.id]
    if (shiftKey && anchor) {
      const anchorIndex = filteredSourceNodes.findIndex((node) => node.name === anchor); const targetIndex = filteredSourceNodes.findIndex((node) => node.name === name)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        filteredSourceNodes.slice(start, end + 1).forEach((node) => next.add(node.name)); setSourceSelection(next); return
      }
    }
    if (next.has(name)) next.delete(name); else next.add(name)
    setSourceSelection(next); setTransferAnchors((current) => ({ ...current, [transferSource.id]: name }))
  }

  const copyIntoMain = () => {
    if (!mainDocument || !transferTotal) return
    let nextSource = mainDocument.source; let copied = 0; let skipped = 0; let renamed = 0; let dependencies = 0
    try {
      for (const sourceDocument of sourceDocuments) {
        const names = Array.from(transferSelections[sourceDocument.id] ?? []); if (!names.length) continue
        const result = copyProxyNodes(sourceDocument.source, nextSource, names, conflictStrategy)
        nextSource = result.yaml; copied += result.copiedNames.length; skipped += result.skippedNames.length; renamed += result.renamed.length; dependencies += result.dependencyCount
      }
      const details = [dependencies ? `自动带入 ${dependencies} 个依赖` : '', renamed ? `自动改名 ${renamed} 个` : '', skipped ? `跳过 ${skipped} 个` : ''].filter(Boolean).join('，')
      commitSource(mainDocument.id, nextSource, `已向主文件加入 ${copied} 个节点${details ? `，${details}` : ''}`)
      setTransferSelections({}); setActiveId(mainDocument.id)
    } catch (error) { onFlash(error instanceof Error ? error.message : '节点复制失败') }
  }

  const setSplitSelection = (id: string, selected: Set<string>) => setSplitSelections((current) => ({ ...current, [id]: selected }))
  const toggleSplitNode = (document: ConfigDocument, visible: ProxyNode[], name: string, shiftKey: boolean) => {
    const selected = splitSelections[document.id] ?? new Set<string>()
    const next = new Set(selected)
    const anchor = splitAnchors[document.id]
    if (shiftKey && anchor) {
      const anchorIndex = visible.findIndex((node) => node.name === anchor)
      const targetIndex = visible.findIndex((node) => node.name === name)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        visible.slice(start, end + 1).forEach((node) => next.add(node.name))
        setSplitSelection(document.id, next)
        return
      }
    }
    if (next.has(name)) next.delete(name); else next.add(name)
    setSplitSelection(document.id, next)
    setSplitAnchors((current) => ({ ...current, [document.id]: name }))
  }

  const beginSplitDrag = (event: DragEvent<HTMLButtonElement>, document: ConfigDocument, name: string) => {
    const selected = splitSelections[document.id] ?? new Set<string>()
    const names = selected.has(name) ? Array.from(selected) : [name]
    if (!selected.has(name)) setSplitSelection(document.id, new Set([name]))
    setSplitDragging({ sourceId: document.id, names })
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', names.join('\n'))
  }

  const dropIntoSplitDocument = (target: ConfigDocument) => {
    if (!splitDragging || splitDragging.sourceId === target.id) { setSplitDropTarget(''); return }
    const sourceDocument = documents.find((document) => document.id === splitDragging.sourceId)
    if (!sourceDocument) return
    try {
      const result = copyProxyNodes(sourceDocument.source, target.source, splitDragging.names, conflictStrategy)
      const details = [result.dependencyCount ? `自动带入 ${result.dependencyCount} 个依赖` : '', result.renamed.length ? `自动改名 ${result.renamed.length} 个` : '', result.skippedNames.length ? `跳过 ${result.skippedNames.length} 个` : ''].filter(Boolean).join('，')
      commitSource(target.id, result.yaml, `已复制 ${result.copiedNames.length} 个节点到 ${target.filename}${details ? `，${details}` : ''}`)
      setActiveId(target.id)
    } catch (error) { onFlash(error instanceof Error ? error.message : '节点拖拽复制失败') }
    finally { setSplitDragging(null); setSplitDropTarget('') }
  }

  const renderTransferCard = (node: ProxyNode, selected: boolean, onClick?: (event: MouseEvent<HTMLButtonElement>) => void) => <button type="button" key={node.name} className={`transfer-node-card ${selected ? 'selected' : ''} ${onClick ? '' : 'readonly'}`} onClick={onClick}>
    {onClick && <span className={`node-check ${selected ? 'checked' : ''}`}>{selected && <Check size={12} strokeWidth={3} />}</span>}
    <span><strong>{node.name}</strong><small>{node.server ? `${node.server}${node.port ? `:${node.port}` : ''}` : '未填写服务器地址'}</small></span><b>{protocolLabel(node.type)}</b>
  </button>

  const renderSplitPane = (document: ConfigDocument) => {
    const documentParsed = parsedDocuments.get(document.id)?.data
    const selected = splitSelections[document.id] ?? new Set<string>()
    const query = (splitQueries[document.id] ?? '').trim().toLowerCase()
    const protocol = splitProtocols[document.id] ?? ''
    const protocols = Array.from(new Set((documentParsed?.proxies ?? []).map((node) => String(node.type ?? '未知')))).sort(collator.compare)
    const visible = (documentParsed?.proxies ?? []).filter((node) => (!protocol || String(node.type ?? '未知') === protocol) && (!query || `${node.name} ${node.type ?? ''} ${node.server ?? ''}`.toLowerCase().includes(query)))
    const allVisibleSelected = visible.length > 0 && visible.every((node) => selected.has(node.name))
    const isDropTarget = splitDropTarget === document.id && splitDragging?.sourceId !== document.id
    return <section
      className={`split-pane ${isDropTarget ? 'drop-target' : ''}`}
      onDragOver={(event) => { if (splitDragging?.sourceId !== document.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setSplitDropTarget(document.id) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSplitDropTarget('') }}
      onDrop={(event) => { event.preventDefault(); dropIntoSplitDocument(document) }}
    >
      <div className="split-pane-title"><div><FileCode2 size={17} /><span><strong>{document.filename}</strong><small>{documentParsed?.proxies.length ?? 0} 个节点</small></span></div><b>已选 {selected.size}</b></div>
      <div className="split-tools">
        <label className="search-box"><Search size={15} /><input value={splitQueries[document.id] ?? ''} onChange={(event) => setSplitQueries((current) => ({ ...current, [document.id]: event.target.value }))} placeholder="搜索名称、协议或地址" />{query && <button onClick={() => setSplitQueries((current) => ({ ...current, [document.id]: '' }))}><X size={13} /></button>}</label>
        <select value={protocol} onChange={(event) => setSplitProtocols((current) => ({ ...current, [document.id]: event.target.value }))}><option value="">全部协议</option>{protocols.map((item) => <option key={item} value={item}>{protocolLabel(item)}</option>)}</select>
        <button type="button" onClick={() => setSplitSelection(document.id, allVisibleSelected ? new Set(Array.from(selected).filter((name) => !visible.some((node) => node.name === name))) : new Set([...selected, ...visible.map((node) => node.name)]))}>{allVisibleSelected ? '取消可见' : '全选可见'}</button>
      </div>
      <div className="split-node-list">{visible.map((node) => <button
        type="button" key={node.name} draggable className={`split-node-card ${selected.has(node.name) ? 'selected' : ''}`}
        onClick={(event) => toggleSplitNode(document, visible, node.name, event.shiftKey)}
        onDragStart={(event) => beginSplitDrag(event, document, node.name)}
        onDragEnd={() => { setSplitDragging(null); setSplitDropTarget('') }}
      ><GripVertical size={14} /><span className={`node-check ${selected.has(node.name) ? 'checked' : ''}`}>{selected.has(node.name) && <Check size={12} strokeWidth={3} />}</span><span><strong>{node.name}</strong><small>{node.server ? `${node.server}${node.port ? `:${node.port}` : ''}` : '未填写服务器地址'}</small></span><b>{protocolLabel(node.type)}</b></button>)}{!visible.length && <div className="transfer-empty"><Search size={25} /><span>没有匹配的节点</span></div>}</div>
      {isDropTarget && <div className="split-drop-overlay"><Columns2 size={28} /><strong>释放鼠标，复制到此配置</strong><span>{splitDragging?.names.length ?? 0} 个节点</span></div>}
      <div className="split-pane-footer"><span>点击选择，Shift 区间选择；拖动已选节点可批量复制</span>{selected.size > 0 && <button type="button" onClick={() => setSplitSelection(document.id, new Set())}>清空选择</button>}</div>
    </section>
  }

  const splitLeft = splitReversed ? documents[1] : documents[0]
  const splitRight = splitReversed ? documents[0] : documents[1]

  return <main className={`config-editor-page ${loaded ? 'has-document' : ''} ${focusMode ? 'focus-mode' : ''} ${transferMode ? 'transfer-mode' : ''} ${splitMode ? 'split-mode' : ''}`}>
    {!loaded && <section className="editor-page-heading"><div className="editor-page-icon"><PencilRuler size={23} /></div><div><span>独立工具</span><h1>配置节点编辑器</h1><p>单配置正常编辑；多配置固定载入两个文件，可左右拖拽或汇总到主文件。</p></div></section>}
    <input ref={fileInput} type="file" multiple accept=".yaml,.yml,text/yaml" hidden onChange={(event) => loadFiles(event.target.files ?? undefined)} />
    {!loaded ? <section className="standalone-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); loadFiles(event.dataTransfer.files) }}>
      <span><Files size={34} /></span><h2>打开一个或两个 YAML 配置</h2><p>单文件独立编辑，载入两个文件后可以使用多配置功能。</p><button type="button" onClick={() => fileInput.current?.click()}><FileUp size={17} /> 选择配置文件</button><small>也可以把 .yaml 或 .yml 文件拖到这里</small>
    </section> : <>
      <div className="multi-document-bar">
        <div className="document-tabs" role="tablist" aria-label="已打开的配置">{documents.map((document) => <div key={document.id} className={`document-tab ${active?.id === document.id ? 'active' : ''} ${mainId === document.id ? 'main' : ''}`}>
          <button type="button" role="tab" aria-selected={active?.id === document.id} onClick={() => { setActiveId(document.id); setTransferMode(false); setSplitMode(false) }}>{mainId === document.id ? <Crown size={13} /> : <FileCode2 size={13} />}<span>{document.filename}</span><b>{parsedDocuments.get(document.id)?.data?.proxies.length ?? 0}</b></button>
          <button type="button" className="close-document" onClick={() => closeDocument(document.id)} aria-label={`关闭 ${document.filename}`}><X size={12} /></button>
        </div>)}</div>
        <button type="button" className="add-document" disabled={documents.length >= 2} onClick={() => fileInput.current?.click()}><FilePlus2 size={14} />添加配置 <span>{documents.length}/2</span></button>
        <button type="button" className={`split-mode-button ${splitMode ? 'active' : ''}`} disabled={documents.length !== 2} onClick={startSplitMode}><Columns2 size={15} />左右拖拽</button>
        <button type="button" className={`transfer-mode-button ${transferMode ? 'active' : ''}`} disabled={documents.length < 2} onClick={startTransferMode}><Layers3 size={15} />主文件汇总</button>
      </div>

      {splitMode && splitLeft && splitRight ? <section className="split-workspace">
        <div className="split-heading"><div><span><Columns2 size={18} /></span><div><strong>双配置左右拖拽</strong><small>节点拖到另一侧即执行复制，来源文件保持不变</small></div></div>
          <label>同名处理<select value={conflictStrategy} onChange={(event) => setConflictStrategy(event.target.value as CopyConflictStrategy)}><option value="rename">自动改名</option><option value="skip">跳过同名</option><option value="replace">覆盖目标节点</option></select></label>
          <button type="button" onClick={() => setSplitReversed(!splitReversed)}><ArrowRightLeft size={15} />交换左右</button><button type="button" onClick={() => setFocusMode(!focusMode)}>{focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{focusMode ? '退出全屏' : '全屏'}</button><button type="button" onClick={() => setSplitMode(false)}><X size={15} />退出拖拽</button>
        </div>
        <div className="split-layout">{renderSplitPane(splitLeft)}<div className="split-divider"><ArrowRightLeft size={21} /><span>双向复制</span></div>{renderSplitPane(splitRight)}</div>
        <div className="split-note"><ShieldCheck size={15} /><span>拖拽只复制节点，不删除来源；自动处理 dialer-proxy 依赖，目标文件可用撤销恢复。</span></div>
      </section> : transferMode && mainDocument && transferSource ? <section className="transfer-workspace">
        <div className="transfer-heading"><div><span><Layers3 size={18} /></span><div><strong>主文件汇总</strong><small>从其他配置选择节点，统一加入指定主文件</small></div></div>
          <label>主文件<select value={mainDocument.id} onChange={(event) => changeMainDocument(event.target.value)}>{documents.map((document) => <option value={document.id} key={document.id}>{document.filename}</option>)}</select></label>
          <label>同名处理<select value={conflictStrategy} onChange={(event) => setConflictStrategy(event.target.value as CopyConflictStrategy)}><option value="rename">自动改名</option><option value="skip">跳过同名</option><option value="replace">覆盖主文件节点</option></select></label>
          <button type="button" onClick={() => setFocusMode(!focusMode)}>{focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{focusMode ? '退出全屏' : '全屏'}</button><button type="button" onClick={() => setTransferMode(false)}><X size={15} />退出汇总</button>
        </div>
        <div className="transfer-layout">
          <section className="transfer-pane source-pane"><div className="transfer-pane-title"><div><Files size={16} /><span><strong>来源配置</strong><small>可跨文件累计选择</small></span></div><b>已选 {transferTotal}</b></div>
            <div className="transfer-source-tabs">{sourceDocuments.map((document) => <button type="button" key={document.id} className={transferSource.id === document.id ? 'active' : ''} onClick={() => { setTransferSourceId(document.id); setTransferQuery(''); setTransferProtocol('') }}>{document.filename}<span>{transferSelections[document.id]?.size ?? 0}</span></button>)}</div>
            <div className="transfer-tools"><label className="search-box"><Search size={15} /><input value={transferQuery} onChange={(event) => setTransferQuery(event.target.value)} placeholder="搜索来源节点" />{transferQuery && <button onClick={() => setTransferQuery('')}><X size={13} /></button>}</label>
              <select value={transferProtocol} onChange={(event) => setTransferProtocol(event.target.value)}><option value="">全部协议</option>{availableProtocols.map((protocol) => <option key={protocol} value={protocol}>{protocolLabel(protocol)}</option>)}</select>
              <select value={transferSort} onChange={(event) => setTransferSort(event.target.value as TransferSort)}><option value="manual">原始顺序</option><option value="name">按名称</option><option value="type">按协议</option><option value="server">按服务器</option></select>
              <button type="button" onClick={() => { const visible = filteredSourceNodes.map((node) => node.name); const allSelected = visible.length > 0 && visible.every((name) => sourceSelection.has(name)); setSourceSelection(allSelected ? new Set(Array.from(sourceSelection).filter((name) => !visible.includes(name))) : new Set([...sourceSelection, ...visible])) }}>{filteredSourceNodes.length > 0 && filteredSourceNodes.every((node) => sourceSelection.has(node.name)) ? '取消可见' : '全选可见'}</button>
            </div>
            <div className="transfer-node-list">{filteredSourceNodes.map((node) => renderTransferCard(node, sourceSelection.has(node.name), (event) => toggleTransferNode(node.name, event.shiftKey)))}{!filteredSourceNodes.length && <div className="transfer-empty"><Search size={25} /><span>没有匹配的节点</span></div>}</div>
            <div className="transfer-pane-footer"><span>{transferSource.filename}：选择 {sourceSelection.size} / {sourceParsed?.proxies.length ?? 0}</span>{sourceSelection.size > 0 && <button type="button" onClick={() => setSourceSelection(new Set())}>清空当前文件</button>}</div>
          </section>
          <div className="transfer-direction"><ArrowRight size={20} /></div>
          <section className="transfer-pane main-pane"><div className="transfer-pane-title"><div><Crown size={16} /><span><strong>主文件</strong><small>{mainDocument.filename}</small></span></div><b>{mainParsed?.proxies.length ?? 0} 个节点</b></div>
            <div className="transfer-main-search"><label className="search-box"><Search size={15} /><input value={mainQuery} onChange={(event) => setMainQuery(event.target.value)} placeholder="搜索主文件节点" />{mainQuery && <button onClick={() => setMainQuery('')}><X size={13} /></button>}</label></div>
            <div className="transfer-node-list main-list">{filteredMainNodes.map((node) => renderTransferCard(node, false))}{!filteredMainNodes.length && <div className="transfer-empty"><FileCode2 size={25} /><span>主文件中没有节点</span></div>}</div><div className="transfer-pane-footer"><span>复制后只修改主文件，来源配置保持不变</span></div>
          </section>
        </div>
        <div className="transfer-actionbar"><span><ShieldCheck size={15} />自动复制 dialer-proxy 依赖，整批操作可以撤销</span><button type="button" disabled={!transferTotal} onClick={() => setTransferSelections({})}>清空全部</button><button type="button" className="primary" disabled={!transferTotal} onClick={copyIntoMain}>将 {transferTotal} 个所选节点加入主文件 <ArrowRight size={16} /></button></div>
      </section> : active && <section className="standalone-editor-shell">
        <div className="editor-filebar"><span className="editor-file-icon"><FileCode2 size={19} /></span><div><strong>{active.filename}</strong><small>{parsed.error ? '配置存在语法错误' : `${parsed.data?.proxies.length ?? 0} 个节点 · ${parsed.data?.groups.length ?? 0} 个策略组`}</small></div>
          {!parsed.error && <div className="editor-workspace-tabs compact" role="tablist" aria-label="配置编辑工作区"><button type="button" role="tab" aria-selected={workspace === 'nodes'} className={workspace === 'nodes' ? 'active' : ''} onClick={() => setWorkspace('nodes')}>节点管理 <span>{parsed.data?.proxies.length ?? 0}</span></button><button type="button" role="tab" aria-selected={workspace === 'groups'} className={workspace === 'groups' ? 'active' : ''} onClick={() => setWorkspace('groups')}>节点组管理 <span>{parsed.data?.groups.length ?? 0}</span></button></div>}
          {!parsed.error && !!parsed.data?.proxies.length && <button type="button" className="editor-file-action" onClick={() => setRefreshId(active.id)}><RotateCcw size={15} />离线刷新</button>}<div className="editor-history-actions"><button type="button" disabled={active.historyIndex <= 0} onClick={() => travelHistory(active, active.historyIndex - 1)} title="撤销"><Undo2 size={15} /></button><button type="button" disabled={active.historyIndex >= active.history.length - 1} onClick={() => travelHistory(active, active.historyIndex + 1)} title="恢复"><Redo2 size={15} /></button></div>
          <button type="button" className="editor-file-action" onClick={() => setShowSource(!showSource)}><History size={15} />{showSource ? '收起源码' : '查看源码'}</button><button type="button" className="editor-file-action" disabled={documents.length >= 2} onClick={() => fileInput.current?.click()}><FilePlus2 size={15} />添加配置</button><button type="button" className="editor-file-action focus-toggle" onClick={() => setFocusMode(!focusMode)}>{focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{focusMode ? '退出全屏' : '全屏编辑'}</button><button type="button" className="editor-file-action" onClick={() => closeDocument(active.id)}><RotateCcw size={15} />关闭</button>
        </div>
        {refreshId === active.id && parsed.data && <RefreshDialog key={active.id} filename={active.filename} source={active.source} nodes={parsed.data.proxies} onClose={() => setRefreshId('')} onApply={(source, count) => { commitSource(active.id, source, `已离线刷新 ${count} 个节点`); setRefreshId('') }} />}
        {parsed.error && <div className="editor-parse-error"><CircleAlert size={16} />{parsed.error}</div>}{showSource && <div className="standalone-source"><div><span>YAML 源码预览</span><small>节点内容只读，修改请使用卡片操作</small></div><textarea value={active.source} readOnly spellCheck={false} /></div>}
        {!parsed.error && (workspace === 'nodes' ? <NodeManager configId={active.id} source={active.source} nodes={parsed.data?.proxies ?? []} selected={active.selected} mode={active.mode} onModeChange={(nextMode) => updateMode(active.id, nextMode)} onSelectionChange={(selected) => updateSelection(active.id, selected)} onSourceChange={(source, message) => commitSource(active.id, source, message)} /> : <GroupManager source={active.source} nodes={parsed.data?.proxies ?? []} groups={parsed.data?.groups ?? []} onSourceChange={(source, message) => commitSource(active.id, source, message)} />)}
        <div className="editor-exportbar"><span><ShieldCheck size={15} /> 当前文件的所有修改均在本地完成</span><button type="button" className="handoff-button" onClick={() => onSendToBuilder(active.source, active.filename)}><ArrowRightLeft size={15} />转到出口生成</button><button type="button" onClick={copyYaml}><Clipboard size={15} />复制 YAML</button><button type="button" disabled={!!parsed.error} onClick={() => onShareYaml(active.source, editedFilename)}><QrCode size={16} />二维码</button><button type="button" className="primary" disabled={!!parsed.error} onClick={downloadYaml}><Download size={16} />下载 YAML</button></div>
      </section>}
    </>}
  </main>
}
