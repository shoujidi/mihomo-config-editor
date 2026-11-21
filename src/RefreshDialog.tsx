import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProxyNode } from './core'
import { applyRefresh, readRefreshFile, refreshRows, type RefreshCandidate } from './refresh'

type Props = { filename: string; source: string; nodes: ProxyNode[]; onClose: () => void; onApply: (yaml: string, count: number) => void }

export default function RefreshDialog({ filename, source, nodes, onClose, onApply }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef(0)
  const [candidates, setCandidates] = useState<RefreshCandidate[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [manualTarget, setManualTarget] = useState('')
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map())
  const rows = useMemo(() => refreshRows(nodes, candidates), [nodes, candidates])
  const index = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates])
  const byProtocol = useMemo(() => {
    const result = new Map<string, RefreshCandidate[]>()
    for (const item of candidates) {
      const type = String(item.node.type ?? '').toLowerCase()
      const group = result.get(type) ?? []
      group.push(item)
      result.set(type, group)
    }
    return result
  }, [candidates])
  const categories = useMemo(() => [...new Set(rows.map(({ node }) => String(node.type ?? '未知')))].sort(), [rows])
  const visible = rows.filter(({ node }) => (!category || (node.type ?? '未知') === category) && node.name.toLowerCase().includes(query.trim().toLowerCase()))
  const getChoice = (name: string, auto?: string) => assignments.get(name) ?? auto
  const ready = visible.filter(({ node, auto, blocked }) => !blocked && !!getChoice(node.name, auto))
  const choices = new Map<string, RefreshCandidate>()
  for (const { node, auto, blocked } of rows) {
    const choice = index.get(getChoice(node.name, auto) ?? '')
    if (!blocked && selected.has(node.name) && choice) choices.set(node.name, choice)
  }
  const duplicates = new Set([...choices.values()].map((item) => item.id)).size !== choices.size
  useEffect(() => { dialog.current?.showModal(); return () => { request.current += 1 } }, [])

  const load = async (files: File[]) => {
    if (!files.length) return
    const id = ++request.current
    setBusy(true)
    setSelected(new Set()); setAssignments(new Map()); setManualTarget(''); setErrors([]); setCandidates([])
    const results = await Promise.all(files.map(async (file, i) => {
      try {
        if (!/\.ya?ml$/i.test(file.name)) return { error: `${file.name}：仅支持 YAML / YML 文件` }
        return { candidates: readRefreshFile(await file.text(), file.name, i) }
      } catch {
        return { error: `${file.name}：无法读取，或没有有效的 proxies 节点` }
      }
    }))
    if (id !== request.current) return
    setCandidates(results.flatMap((result) => result.candidates ?? []))
    setErrors(results.flatMap((result) => result.error ? [result.error] : []))
    setBusy(false)
  }

  const apply = () => {
    if (!choices.size || duplicates) return
    try { onApply(applyRefresh(source, choices), choices.size) }
    catch (error) { setErrors([error instanceof Error ? error.message : '刷新失败']) }
  }

  return <dialog ref={dialog} className="refresh-dialog" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <header><div><h2>离线刷新节点</h2><p>目标：{filename}</p></div><button type="button" onClick={onClose} aria-label="关闭刷新">关闭</button></header>
    <p>选择一个或多个新订阅 YAML，浏览器只从本地读取。自动建议仅匹配唯一的同名同协议节点；不能仅凭名称确认机场，批量选中后请核对来源。重名或改名节点可手动指定。</p>
    <label>本地订阅文件 <input type="file" multiple accept=".yaml,.yml,text/yaml" onChange={(event) => { void load(Array.from(event.target.files ?? [])); event.target.value = '' }} /></label>
    {busy && <p role="status">正在读取本地文件…</p>}
    {errors.length > 0 && <ul role="alert">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
    {candidates.length > 0 && <><div className="refresh-toolbar">
      <label>节点搜索 <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>协议分类 <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部协议</option>{categories.map((type) => <option key={type}>{type}</option>)}</select></label>
      <button type="button" disabled={!ready.length} onClick={() => setSelected((old) => new Set([...old, ...ready.map(({ node }) => node.name)]))}>选中当前分类的匹配</button>
      <button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>清空勾选</button>
    </div><div className="refresh-results">
      {!visible.length && <p>没有符合筛选条件的目标节点。</p>}
      {visible.map(({ node, auto, blocked, ambiguous }, rowIndex) => {
        const choice = getChoice(node.name, auto)
        const current = choice ? index.get(choice) : undefined
        const menu = manualTarget === node.name ? byProtocol.get(String(node.type ?? '').toLowerCase()) ?? [] : current ? [current] : []
        return <div className="refresh-row" key={`${node.name}:${rowIndex}`}>
          <label><input type="checkbox" disabled={blocked || !choice} checked={!blocked && selected.has(node.name)} onChange={(event) => {
            const checked = event.target.checked
            setSelected((old) => { const next = new Set(old); if (checked) next.add(node.name); else next.delete(node.name); return next })
          }} /> {node.name} <small>{node.type}</small></label>
          {blocked ? <small>目标节点重名，不能安全刷新</small> : <div className="refresh-source-choice"><button type="button" onClick={() => setManualTarget(node.name)} aria-expanded={manualTarget === node.name}>{current ? current.file + ' · ' + current.node.name : ambiguous ? '多个来源同名，请指定' : '手动指定来源'}</button>{manualTarget === node.name && <label>来源 <select aria-label={`${node.name} 的来源`} value={choice ?? ''} onFocus={() => setManualTarget(node.name)} onChange={(event) => {
            const id = event.target.value
            setAssignments((old) => new Map(old).set(node.name, id))
            if (!id) setSelected((old) => { const next = new Set(old); next.delete(node.name); return next })
          }}><option value="">{ambiguous ? '多个来源同名，请选择' : '不更新／手动选择'}</option>
            {menu.map((item) =>
              <option key={item.id} value={item.id}>{item.file} · {item.node.name}（{item.id}）</option>)}
          </select></label>}</div>}
        </div>
      })}
    </div></>}
    <footer><span>{duplicates ? '不能将同一个来源节点用于多个目标' : `已选 ${choices.size} 个；名称、策略组、规则及本地 dialer-proxy 不变`}</span><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy || !choices.size || duplicates} onClick={apply}>应用刷新</button></footer>
  </dialog>
}
