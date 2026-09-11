import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  CircleAlert,
  CopyCheck,
  Filter,
  GripVertical,
  Layers3,
  ListFilter,
  MoveDown,
  MoveUp,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { deleteProxyGroup, findRuleReferences, orderProxyGroupReferences, renameProxyGroup, type ProxyGroup, type ProxyGroupOrder, type ProxyNode, type RuleReference } from './core'

type GroupSortMode = 'manual' | 'name-asc' | 'name-desc' | 'protocol' | 'server' | 'global'
type SpecialPlacement = 'keep' | 'top' | 'bottom'
type ReferenceKind = 'node' | 'group' | 'special' | 'unknown'
type DeleteGroupState = { groupName: string; target: string; rules: RuleReference[]; selectedRuleIds: Set<string>; nestedCount: number }

type GroupManagerProps = {
  source: string
  nodes: ProxyNode[]
  groups: ProxyGroup[]
  onSourceChange: (source: string, message: string) => void
}

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const SPECIAL_REFERENCES = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL'])
const ALL_NODES_VIEW = '__all_config_nodes__'

function uniqueReferences(refs: string[]) {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    if (seen.has(ref)) return false
    seen.add(ref)
    return true
  })
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function groupTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    select: '选择', 'url-test': '测速', fallback: '故障转移', 'load-balance': '负载均衡', relay: '链式',
  }
  return labels[String(type ?? '')] ?? String(type ?? '未知')
}

export default function GroupManager({ source, nodes, groups, onSourceChange }: GroupManagerProps) {
  const [activeGroup, setActiveGroup] = useState(ALL_NODES_VIEW)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [minSize, setMinSize] = useState('')
  const [maxSize, setMaxSize] = useState('')
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [specialOnly, setSpecialOnly] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [referenceQuery, setReferenceQuery] = useState('')
  const [sortMode, setSortMode] = useState<GroupSortMode>('manual')
  const [specialPlacement, setSpecialPlacement] = useState<SpecialPlacement>('keep')
  const [deduplicate, setDeduplicate] = useState(false)
  const [selectedSortMode, setSelectedSortMode] = useState<Exclude<GroupSortMode, 'manual'>>('name-asc')
  const [columns, setColumns] = useState<1 | 2 | 3>(2)
  const [selectedReferences, setSelectedReferences] = useState<Set<number>>(new Set())
  const [draggingIndexes, setDraggingIndexes] = useState<number[]>([])
  const [draggingReferenceNames, setDraggingReferenceNames] = useState<string[]>([])
  const [groupDropTarget, setGroupDropTarget] = useState('')
  const [referenceSelectionAnchor, setReferenceSelectionAnchor] = useState<number | null>(null)
  const [groupSelectionAnchor, setGroupSelectionAnchor] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [deleteState, setDeleteState] = useState<DeleteGroupState | null>(null)
  const [deleteError, setDeleteError] = useState('')

  useEffect(() => {
    if (activeGroup !== ALL_NODES_VIEW && !groups.some((group) => group.name === activeGroup)) setActiveGroup(ALL_NODES_VIEW)
    setSelectedGroups((current) => new Set(Array.from(current).filter((name) => groups.some((group) => group.name === name))))
  }, [activeGroup, groups])

  useEffect(() => {
    setSelectedReferences(new Set())
    setDraggingIndexes([])
    setReferenceSelectionAnchor(null)
  }, [activeGroup, source, sortMode, specialPlacement, deduplicate])

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.name, node])), [nodes])
  const nodeRank = useMemo(() => new Map(nodes.map((node, index) => [node.name, index])), [nodes])
  const groupNames = useMemo(() => new Set(groups.map((group) => group.name)), [groups])
  const availableTypes = useMemo(() => Array.from(new Set(groups.map((group) => String(group.type ?? '未知')))).sort(collator.compare), [groups])

  const referenceKind = (name: string): ReferenceKind => {
    if (SPECIAL_REFERENCES.has(name.toUpperCase())) return 'special'
    if (nodeMap.has(name)) return 'node'
    if (groupNames.has(name)) return 'group'
    return 'unknown'
  }

  const makeOrder = (refs: string[], mode = sortMode, placement = specialPlacement, removeDuplicates = deduplicate) => {
    const base = removeDuplicates ? uniqueReferences(refs) : [...refs]
    if (mode !== 'manual') {
      const sortable = base.filter((name) => referenceKind(name) === 'node')
      sortable.sort((leftName, rightName) => {
        const left = nodeMap.get(leftName)
        const right = nodeMap.get(rightName)
        if (mode === 'name-desc') return collator.compare(rightName, leftName)
        if (mode === 'protocol') return collator.compare(String(left?.type ?? ''), String(right?.type ?? '')) || collator.compare(leftName, rightName)
        if (mode === 'server') return collator.compare(String(left?.server ?? ''), String(right?.server ?? '')) || collator.compare(leftName, rightName)
        if (mode === 'global') return (nodeRank.get(leftName) ?? Number.MAX_SAFE_INTEGER) - (nodeRank.get(rightName) ?? Number.MAX_SAFE_INTEGER)
        return collator.compare(leftName, rightName)
      })
      let cursor = 0
      for (let index = 0; index < base.length; index += 1) {
        if (referenceKind(base[index]) === 'node') base[index] = sortable[cursor++]
      }
    }
    if (placement !== 'keep') {
      const special = base.filter((name) => referenceKind(name) === 'special')
      const rest = base.filter((name) => referenceKind(name) !== 'special')
      return placement === 'top' ? [...special, ...rest] : [...rest, ...special]
    }
    return base
  }

  const filteredGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const min = minSize ? Number(minSize) : undefined
    const max = maxSize ? Number(maxSize) : undefined
    return groups.filter((group) => {
      const refs = group.proxies ?? []
      if (keyword && !`${group.name} ${group.type ?? ''}`.toLowerCase().includes(keyword)) return false
      if (typeFilter !== 'all' && String(group.type ?? '未知') !== typeFilter) return false
      if (min != null && refs.length < min) return false
      if (max != null && refs.length > max) return false
      if (duplicatesOnly && new Set(refs).size === refs.length) return false
      if (specialOnly && !refs.some((name) => SPECIAL_REFERENCES.has(name.toUpperCase()))) return false
      return true
    })
  }, [duplicatesOnly, groups, maxSize, minSize, query, specialOnly, typeFilter])

  const viewingAllNodes = activeGroup === ALL_NODES_VIEW
  const current = viewingAllNodes
    ? ({ name: '全部节点', type: 'virtual', proxies: nodes.map((node) => node.name) } as ProxyGroup)
    : groups.find((group) => group.name === activeGroup)
  const currentRefs = current?.proxies ?? []
  const previewRefs = viewingAllNodes ? currentRefs : makeOrder(currentRefs)
  const previewChanged = !viewingAllNodes && !sameOrder(currentRefs, previewRefs)
  const visibleRefs = previewChanged ? previewRefs : currentRefs
  const filteredRefs = visibleRefs.map((name, index) => ({ name, index })).filter(({ name }) => !referenceQuery.trim() || name.toLowerCase().includes(referenceQuery.trim().toLowerCase()))
  const allFilteredReferencesSelected = filteredRefs.length > 0 && filteredRefs.every(({ index }) => selectedReferences.has(index))
  const activeFilterCount = Number(typeFilter !== 'all') + Number(!!minSize || !!maxSize) + Number(duplicatesOnly) + Number(specialOnly)
  const fallbackAffected = (names: string[]) => groups.some((group) => names.includes(group.name) && group.type === 'fallback')

  const commitOrders = (updates: ProxyGroupOrder[], message: string) => {
    if (!updates.length) return
    if (fallbackAffected(updates.map((update) => update.groupName)) && !window.confirm('所选内容包含 fallback 故障转移组，排序会改变故障切换优先级。确定继续吗？')) return
    try {
      onSourceChange(orderProxyGroupReferences(source, updates), message)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '策略组排序失败')
    }
  }

  const applyCurrentPreview = () => {
    if (!current || !previewChanged) return
    commitOrders([{ groupName: current.name, proxies: previewRefs }], `已更新策略组「${current.name}」的节点顺序`)
  }

  const applyBatch = () => {
    const updates = groups
      .filter((group) => selectedGroups.has(group.name) && Array.isArray(group.proxies))
      .map((group) => ({ groupName: group.name, proxies: makeOrder(group.proxies ?? []) }))
      .filter((update) => !sameOrder(groups.find((group) => group.name === update.groupName)?.proxies ?? [], update.proxies))
    if (!updates.length) {
      window.alert(selectedGroups.size ? '所选策略组应用当前规则后没有变化' : '请先选择策略组')
      return
    }
    commitOrders(updates, `已批量更新 ${updates.length} 个策略组的节点顺序`)
  }

  const moveReference = (from: number, to: number) => {
    if (!current || from === to || from < 0 || to < 0 || from >= currentRefs.length || to >= currentRefs.length) return
    const next = [...currentRefs]
    const [moving] = next.splice(from, 1)
    next.splice(to, 0, moving)
    commitOrders([{ groupName: current.name, proxies: next }], `已调整「${current.name}」中的节点位置`)
  }

  const moveReferenceBlock = (indexes: number[], target: number | 'top' | 'bottom' | 'up' | 'down') => {
    if (!current || !indexes.length) return
    const orderedIndexes = Array.from(new Set(indexes)).filter((index) => index >= 0 && index < currentRefs.length).sort((a, b) => a - b)
    if (!orderedIndexes.length) return
    const selectedSet = new Set(orderedIndexes)
    if (typeof target === 'number' && selectedSet.has(target)) return
    const moving = orderedIndexes.map((index) => currentRefs[index])
    const remainingEntries = currentRefs.map((name, index) => ({ name, index })).filter(({ index }) => !selectedSet.has(index))
    let insertAt = 0
    if (target === 'bottom') insertAt = remainingEntries.length
    else if (target === 'top') insertAt = 0
    else if (target === 'up') {
      const previous = [...remainingEntries].reverse().find(({ index }) => index < orderedIndexes[0])
      if (!previous) return
      insertAt = remainingEntries.findIndex(({ index }) => index === previous.index)
    } else if (target === 'down') {
      const next = remainingEntries.find(({ index }) => index > orderedIndexes[orderedIndexes.length - 1])
      if (!next) return
      insertAt = remainingEntries.findIndex(({ index }) => index === next.index) + 1
    } else {
      insertAt = remainingEntries.filter(({ index }) => index < target).length
    }
    const remaining = remainingEntries.map(({ name }) => name)
    const nextOrder = [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)]
    commitOrders([{ groupName: current.name, proxies: nextOrder }], `已批量移动「${current.name}」中的 ${moving.length} 个节点`)
  }

  const dropReference = (target: number) => {
    if (viewingAllNodes) return
    if (!draggingIndexes.length) return
    moveReferenceBlock(draggingIndexes, target)
    setDraggingIndexes([])
  }

  const addNodesToGroup = (groupName: string, names: string[]) => {
    const targetGroup = groups.find((group) => group.name === groupName)
    if (!targetGroup) return
    const nodeNames = uniqueReferences(names.filter((name) => nodeMap.has(name)))
    const existing = new Set(targetGroup.proxies ?? [])
    const additions = nodeNames.filter((name) => !existing.has(name))
    if (!additions.length) {
      window.alert(nodeNames.length ? '所选节点已经全部存在于该策略组' : '请先在右侧选择节点')
      return
    }
    commitOrders([{ groupName, proxies: [...(targetGroup.proxies ?? []), ...additions] }], `已向策略组「${groupName}」添加 ${additions.length} 个节点`)
    setGroupDropTarget('')
  }

  const selectedReferenceNames = () => Array.from(selectedReferences).sort((a, b) => a - b).map((index) => currentRefs[index]).filter(Boolean)

  const removeReferences = (indexes: number[]) => {
    if (!current || viewingAllNodes || !indexes.length) return
    const removed = new Set(indexes)
    const next = currentRefs.filter((_, index) => !removed.has(index))
    const count = currentRefs.length - next.length
    if (!count) return
    commitOrders([{ groupName: current.name, proxies: next }], `已从策略组「${current.name}」移除 ${count} 个引用，实际节点未删除`)
    setSelectedReferences(new Set())
  }

  const sortSelectedReferences = () => {
    if (!current || selectedReferences.size < 2) return
    const indexes = Array.from(selectedReferences).sort((a, b) => a - b)
    const sortedSelection = makeOrder(indexes.map((index) => currentRefs[index]), selectedSortMode, specialPlacement, false)
    const nextOrder = [...currentRefs]
    indexes.forEach((index, position) => { nextOrder[index] = sortedSelection[position] })
    commitOrders([{ groupName: current.name, proxies: nextOrder }], `已排序「${current.name}」中选定的 ${indexes.length} 个节点`)
  }

  const toggleReference = (index: number, shiftKey = false) => {
    if (shiftKey && referenceSelectionAnchor != null) {
      const visibleIndexes = filteredRefs.map((item) => item.index)
      const anchorPosition = visibleIndexes.indexOf(referenceSelectionAnchor)
      const targetPosition = visibleIndexes.indexOf(index)
      if (anchorPosition >= 0 && targetPosition >= 0) {
        const [start, end] = anchorPosition < targetPosition ? [anchorPosition, targetPosition] : [targetPosition, anchorPosition]
        setSelectedReferences(new Set([...selectedReferences, ...visibleIndexes.slice(start, end + 1)]))
        return
      }
    }
    const next = new Set(selectedReferences)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedReferences(next)
    setReferenceSelectionAnchor(index)
  }

  const toggleGroup = (event: MouseEvent, name: string) => {
    event.stopPropagation()
    if (event.shiftKey && groupSelectionAnchor) {
      const anchorIndex = filteredGroups.findIndex((group) => group.name === groupSelectionAnchor)
      const targetIndex = filteredGroups.findIndex((group) => group.name === name)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        setSelectedGroups(new Set([...selectedGroups, ...filteredGroups.slice(start, end + 1).map((group) => group.name)]))
        return
      }
    }
    const next = new Set(selectedGroups)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelectedGroups(next)
    setGroupSelectionAnchor(name)
  }

  const selectAllVisible = () => {
    const names = filteredGroups.map((group) => group.name)
    const allSelected = names.length > 0 && names.every((name) => selectedGroups.has(name))
    setSelectedGroups(allSelected ? new Set(Array.from(selectedGroups).filter((name) => !names.includes(name))) : new Set([...selectedGroups, ...names]))
  }

  const applyGroupRename = () => {
    if (!current) return
    try {
      const oldName = current.name
      const newName = renameName.trim()
      const nextSource = renameProxyGroup(source, oldName, newName)
      if (selectedGroups.has(oldName)) {
        const nextSelected = new Set(selectedGroups)
        nextSelected.delete(oldName)
        nextSelected.add(newName)
        setSelectedGroups(nextSelected)
      }
      setActiveGroup(newName)
      setRenameOpen(false)
      onSourceChange(nextSource, `已将策略组「${oldName}」改名，并同步嵌套引用与规则`)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : '策略组改名失败')
    }
  }

  const openDeleteGroup = () => {
    if (!current) return
    try {
      const rules = findRuleReferences(source, current.name)
      const target = groups.find((group) => group.name !== current.name)?.name ?? 'DIRECT'
      const nestedCount = groups.filter((group) => group.name !== current.name && (group.proxies ?? []).includes(current.name)).length
      setDeleteState({ groupName: current.name, target, rules, selectedRuleIds: new Set(target ? rules.map((rule) => rule.id) : []), nestedCount })
      setDeleteError('')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '读取关联规则失败')
    }
  }

  const applyDeleteGroup = () => {
    if (!deleteState) return
    if (!deleteState.target) {
      setDeleteError('请选择关联规则的迁移目标')
      return
    }
    try {
      const nextSource = deleteProxyGroup(source, deleteState.groupName, deleteState.target || undefined, Array.from(deleteState.selectedRuleIds))
      const oldName = deleteState.groupName
      setSelectedGroups(new Set(Array.from(selectedGroups).filter((name) => name !== oldName)))
      setActiveGroup(deleteState.target || groups.find((group) => group.name !== oldName)?.name || '')
      setDeleteState(null)
      onSourceChange(nextSource, `已删除策略组「${oldName}」，并完成关联规则处理`)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除策略组失败')
    }
  }

  return (
    <section className="group-manager">
      <div className="group-manager-toolbar">
        <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索策略组名称或类型" />{query && <button onClick={() => setQuery('')}><X size={14} /></button>}</label>
        <button type="button" className={`filter-button ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}><Filter size={15} />筛选{activeFilterCount > 0 && <b>{activeFilterCount}</b>}<ChevronDown size={14} className={showFilters ? 'rotated' : ''} /></button>
        <button type="button" className={`filter-button ${showRules ? 'active' : ''}`} onClick={() => setShowRules(!showRules)}><ArrowDownAZ size={15} />排序{sortMode !== 'manual' && <b>1</b>}<ChevronDown size={14} className={showRules ? 'rotated' : ''} /></button>
        <button type="button" className="select-all" onClick={selectAllVisible}>全选可见</button>
      </div>

      {showFilters && <div className="group-filter-panel">
        <label><span>组类型</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">全部类型</option>{availableTypes.map((type) => <option value={type} key={type}>{groupTypeLabel(type)}</option>)}</select></label>
        <label><span>最少节点</span><input type="number" min="0" value={minSize} onChange={(event) => setMinSize(event.target.value)} /></label>
        <label><span>最多节点</span><input type="number" min="0" value={maxSize} onChange={(event) => setMaxSize(event.target.value)} /></label>
        <button type="button" className={duplicatesOnly ? 'active' : ''} onClick={() => setDuplicatesOnly(!duplicatesOnly)}><CopyCheck size={13} />含重复节点</button>
        <button type="button" className={specialOnly ? 'active' : ''} onClick={() => setSpecialOnly(!specialOnly)}><ShieldAlert size={13} />含特殊项</button>
      </div>}

      {showRules && <div className="group-rulebar">
        <span><Sparkles size={14} />排序规则</span>
        <label><ArrowDownAZ size={14} /><select value={sortMode} onChange={(event) => setSortMode(event.target.value as GroupSortMode)}><option value="manual">保持当前顺序</option><option value="name-asc">节点名称 A → Z</option><option value="name-desc">节点名称 Z → A</option><option value="protocol">按节点协议</option><option value="server">按服务器地址</option><option value="global">按 YAML 全局节点顺序</option></select></label>
        <label><select value={specialPlacement} onChange={(event) => setSpecialPlacement(event.target.value as SpecialPlacement)}><option value="keep">特殊项保持原位</option><option value="top">特殊项置顶</option><option value="bottom">特殊项置底</option></select></label>
        <label className="dedupe-check"><input type="checkbox" checked={deduplicate} onChange={(event) => setDeduplicate(event.target.checked)} />去除重复项</label>
        <button type="button" className="batch-apply-button" disabled={!selectedGroups.size} onClick={applyBatch}>应用到 {selectedGroups.size} 个组</button>
      </div>}

      <div className="group-manager-layout">
        <aside className="group-list-panel">
          <div className="group-list-heading"><span>策略组</span><b>{filteredGroups.length} / {groups.length}</b></div>
          <div className="group-card-list">
            <button type="button" className={`group-card all-nodes-card ${viewingAllNodes ? 'active' : ''}`} onClick={() => { setActiveGroup(ALL_NODES_VIEW); setReferenceQuery('') }}>
              <span className="all-nodes-mark"><Sparkles size={13} /></span>
              <span><strong>全部节点</strong><small>操作入口 · {nodes.length} 个配置节点</small></span>
              <Layers3 size={15} />
            </button>
            {filteredGroups.map((group) => {
              const refs = group.proxies ?? []
              const duplicateCount = refs.length - new Set(refs).size
              return <button type="button" key={group.name} className={`group-card ${activeGroup === group.name ? 'active' : ''} ${groupDropTarget === group.name ? 'drop-target' : ''}`} onClick={() => { setActiveGroup(group.name); setReferenceQuery('') }}
                onDragOver={(event) => { if (draggingReferenceNames.length) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setGroupDropTarget(group.name) } }}
                onDragLeave={() => { if (groupDropTarget === group.name) setGroupDropTarget('') }}
                onDrop={(event) => { event.preventDefault(); event.stopPropagation(); addNodesToGroup(group.name, draggingReferenceNames); setDraggingReferenceNames([]) }}>
                <span className={`group-select ${selectedGroups.has(group.name) ? 'checked' : ''}`} onClick={(event) => toggleGroup(event, group.name)}>{selectedGroups.has(group.name) && <Check size={11} strokeWidth={3} />}</span>
                <span><strong>{group.name}</strong><small>{groupTypeLabel(group.type)} · {refs.length} 项{duplicateCount > 0 ? ` · ${duplicateCount} 重复` : ''}</small></span>
                <span role="button" tabIndex={0} className="group-add-action" title="把右侧已选节点添加到此组" onClick={(event) => { event.stopPropagation(); addNodesToGroup(group.name, selectedReferenceNames()) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); addNodesToGroup(group.name, selectedReferenceNames()) } }}><Plus size={14} /></span>
              </button>
            })}
            {!filteredGroups.length && <div className="group-empty"><ListFilter size={22} /><span>没有匹配的策略组</span></div>}
          </div>
        </aside>

        <div className="group-reference-panel">
          {current ? <>
            <div className="group-reference-heading">
              <div><span>{viewingAllNodes ? '节点池' : groupTypeLabel(current.type)}</span><h3>{current.name}</h3><p>{viewingAllNodes ? `${currentRefs.length} 个配置节点 · 此入口不会写入 YAML` : `${currentRefs.length} 个引用${previewChanged ? ` · 预览将变为 ${previewRefs.length} 项` : ''}`}</p></div>
              {!viewingAllNodes && <button type="button" className="rename-group-button" onClick={() => { setRenameName(current.name); setRenameError(''); setRenameOpen(true) }}><Pencil size={13} />策略组改名</button>}
              {!viewingAllNodes && <button type="button" className="delete-group-button" onClick={openDeleteGroup}><Trash2 size={13} />删除组</button>}
              <div className="reference-view-switch" role="group" aria-label="组内节点列数"><button className={columns === 1 ? 'active' : ''} onClick={() => setColumns(1)}>1列</button><button className={columns === 2 ? 'active' : ''} onClick={() => setColumns(2)}>2列</button><button className={columns === 3 ? 'active' : ''} onClick={() => setColumns(3)}>3列</button></div>
              <label className="reference-search"><Search size={14} /><input value={referenceQuery} onChange={(event) => setReferenceQuery(event.target.value)} placeholder={viewingAllNodes ? '查找全部节点' : '查找组内节点'} /></label>
              {!viewingAllNodes && <button type="button" className="apply-preview-button" disabled={!previewChanged} onClick={applyCurrentPreview}>{previewChanged ? '应用预览排序' : '当前顺序无需更改'}</button>}
            </div>
            {current.type === 'fallback' && previewChanged && <div className="fallback-warning"><CircleAlert size={14} />排序会改变 fallback 的故障切换优先级</div>}
            {previewChanged && <div className="preview-note"><Sparkles size={13} />当前列表为规则排序预览，应用后才能拖拽调整</div>}
            {!previewChanged && <div className="reference-batchbar">
              <button type="button" className="reference-select-all" onClick={() => { const visibleIndexes = filteredRefs.map(({ index }) => index); setSelectedReferences(allFilteredReferencesSelected ? new Set(Array.from(selectedReferences).filter((index) => !visibleIndexes.includes(index))) : new Set([...selectedReferences, ...visibleIndexes])) }}><span className={allFilteredReferencesSelected ? 'checked' : ''}>{allFilteredReferencesSelected && <Check size={10} strokeWidth={3} />}</span>全选可见</button>
              <b>已选 {selectedReferences.size} 项</b>
              {viewingAllNodes ? <span className="node-pool-hint">选择节点后，拖到左侧策略组或点击组卡片上的 ＋</span> : <>
                <button type="button" disabled={!selectedReferences.size || !!referenceQuery} onClick={() => moveReferenceBlock(Array.from(selectedReferences), 'top')}><MoveUp size={12} />置顶</button>
                <button type="button" disabled={!selectedReferences.size || !!referenceQuery} onClick={() => moveReferenceBlock(Array.from(selectedReferences), 'up')}>上移</button>
                <button type="button" disabled={!selectedReferences.size || !!referenceQuery} onClick={() => moveReferenceBlock(Array.from(selectedReferences), 'down')}>下移</button>
                <button type="button" disabled={!selectedReferences.size || !!referenceQuery} onClick={() => moveReferenceBlock(Array.from(selectedReferences), 'bottom')}><MoveDown size={12} />置底</button>
                <select className="selected-sort-select" value={selectedSortMode} onChange={(event) => setSelectedSortMode(event.target.value as Exclude<GroupSortMode, 'manual'>)}><option value="name-asc">已选：名称 A → Z</option><option value="name-desc">已选：名称 Z → A</option><option value="protocol">已选：按协议</option><option value="server">已选：按服务器</option><option value="global">已选：按全局顺序</option></select>
                <button type="button" className="sort-selected-button" disabled={selectedReferences.size < 2 || !!referenceQuery} onClick={sortSelectedReferences}><ArrowDownAZ size={12} />排序已选</button>
                <button type="button" className="remove-selected-references" disabled={!selectedReferences.size} onClick={() => removeReferences(Array.from(selectedReferences))}><Trash2 size={12} />移出本组</button>
              </>}
              {selectedReferences.size > 0 && <button type="button" className="clear-reference-selection" onClick={() => setSelectedReferences(new Set())}>清空</button>}
            </div>}
            <div className={`group-reference-list columns-${columns} ${previewChanged ? 'previewing' : ''}`}>
              {filteredRefs.map(({ name, index }) => {
                const kind = referenceKind(name)
                const node = nodeMap.get(name)
                return <div
                  className="group-reference-row"
                  key={`${name}-${index}`}
                  draggable={!previewChanged && (viewingAllNodes || !referenceQuery)}
                  onDragStart={(event: DragEvent<HTMLDivElement>) => {
                    const indexes = selectedReferences.has(index) ? Array.from(selectedReferences) : [index]
                    const names = indexes.map((itemIndex) => currentRefs[itemIndex]).filter((itemName) => nodeMap.has(itemName))
                    setDraggingReferenceNames(names)
                    if (!viewingAllNodes) setDraggingIndexes(indexes)
                    event.dataTransfer.effectAllowed = viewingAllNodes ? 'copy' : 'copyMove'
                    event.dataTransfer.setData('text/plain', names.join('\n'))
                  }}
                  onDragOver={(event) => { if (!viewingAllNodes && !previewChanged && !referenceQuery) event.preventDefault() }}
                  onDrop={(event) => { if (!viewingAllNodes) { event.preventDefault(); dropReference(index) } }}
                  onDragEnd={() => { setDraggingIndexes([]); setDraggingReferenceNames([]); setGroupDropTarget('') }}
                >
                  <span className="reference-drag"><GripVertical size={15} /></span>
                  <button type="button" className={`reference-select-box ${selectedReferences.has(index) ? 'checked' : ''}`} disabled={previewChanged} onClick={(event) => toggleReference(index, event.shiftKey)} aria-label={`选择 ${name}`}>{selectedReferences.has(index) && <Check size={10} strokeWidth={3} />}</button>
                  <b>{index + 1}</b>
                  <span className="reference-name"><strong>{name}</strong>{node && <small>{node.type?.toUpperCase() ?? '未知'} · {node.server ?? '无服务器地址'}</small>}</span>
                  <span className={`reference-kind ${kind}`}>{kind === 'node' ? '节点' : kind === 'group' ? '策略组' : kind === 'special' ? '特殊项' : '未知引用'}</span>
                  {!viewingAllNodes && !previewChanged && <span className="reference-move-actions">{!referenceQuery && <><button disabled={index === 0} onClick={() => moveReference(index, index - 1)} title="上移"><MoveUp size={13} /></button><button disabled={index === currentRefs.length - 1} onClick={() => moveReference(index, index + 1)} title="下移"><MoveDown size={13} /></button></>}<button className="reference-remove" onClick={() => removeReferences([index])} title="从本组移除，不删除实际节点"><Trash2 size={13} /></button></span>}
                </div>
              })}
              {!filteredRefs.length && <div className="group-empty"><Search size={22} /><span>组内没有匹配项</span></div>}
            </div>
          </> : <div className="group-empty large"><Layers3 size={26} /><span>选择一个策略组查看节点顺序</span></div>}
        </div>
      </div>

      {renameOpen && current && <div className="editor-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameOpen(false) }}>
        <section className="editor-modal group-rename-modal" role="dialog" aria-modal="true" aria-labelledby="group-rename-title">
          <button type="button" className="editor-modal-close" onClick={() => setRenameOpen(false)} aria-label="关闭"><X size={17} /></button>
          <div className="editor-modal-heading"><span><Pencil size={18} /></span><div><h3 id="group-rename-title">策略组改名</h3><p>自动同步嵌套策略组引用以及 rules / sub-rules 目标</p></div></div>
          <label className="rename-field"><span>新名称</span><input autoFocus value={renameName} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyGroupRename() }} /></label>
          {renameError && <div className="rename-error"><CircleAlert size={14} />{renameError}</div>}
          <div className="editor-modal-actions"><button type="button" onClick={() => setRenameOpen(false)}>取消</button><button type="button" className="primary" onClick={applyGroupRename}>确认并同步</button></div>
        </section>
      </div>}

      {deleteState && <div className="editor-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteState(null) }}>
        <section className="editor-modal delete-group-modal" role="dialog" aria-modal="true" aria-labelledby="delete-group-title">
          <button type="button" className="editor-modal-close" onClick={() => setDeleteState(null)} aria-label="关闭"><X size={17} /></button>
          <div className="editor-modal-heading danger"><span><Trash2 size={18} /></span><div><h3 id="delete-group-title">删除策略组「{deleteState.groupName}」</h3><p>选择需要迁移的关联规则，未勾选的关联规则将从配置中删除</p></div></div>
          <label className="rename-field"><span>关联规则迁移目标</span><select value={deleteState.target} onChange={(event) => setDeleteState({ ...deleteState, target: event.target.value })}><option value="">请选择迁移目标</option>{groups.filter((group) => group.name !== deleteState.groupName).length > 0 && <optgroup label="其他策略组">{groups.filter((group) => group.name !== deleteState.groupName).map((group) => <option key={group.name} value={group.name}>{group.name} · {groupTypeLabel(group.type)}</option>)}</optgroup>}<optgroup label="特殊策略（隐藏选项）"><option value="DIRECT">DIRECT · 直连</option><option value="REJECT">REJECT · 拒绝</option><option value="REJECT-DROP">REJECT-DROP · 静默丢弃</option><option value="PASS">PASS · 继续匹配</option></optgroup></select></label>
          {deleteState.nestedCount > 0 && <div className="delete-nested-note"><Layers3 size={14} />另有 {deleteState.nestedCount} 个策略组引用此组。选择 DIRECT / REJECT / REJECT-DROP 时同步替换；选择 PASS 时安全移除嵌套引用。</div>}
          <div className="delete-rule-heading"><span>关联路由规则</span><div><button type="button" onClick={() => setDeleteState({ ...deleteState, selectedRuleIds: new Set(deleteState.rules.map((rule) => rule.id)) })}>全选迁移</button><button type="button" onClick={() => setDeleteState({ ...deleteState, selectedRuleIds: new Set() })}>全部删除</button></div></div>
          <div className="delete-rule-list">
            {deleteState.rules.map((rule) => <button type="button" key={rule.id} className={deleteState.selectedRuleIds.has(rule.id) ? 'selected' : ''} onClick={() => { const next = new Set(deleteState.selectedRuleIds); if (next.has(rule.id)) next.delete(rule.id); else next.add(rule.id); setDeleteState({ ...deleteState, selectedRuleIds: next }) }}><span>{deleteState.selectedRuleIds.has(rule.id) && <Check size={10} strokeWidth={3} />}</span><code>{rule.text}</code><small>{rule.section}</small></button>)}
            {!deleteState.rules.length && <div className="delete-no-rules">没有直接指向此策略组的 rules / sub-rules</div>}
          </div>
          <div className="delete-summary"><CircleAlert size={14} /><span>将迁移 <strong>{deleteState.target ? deleteState.selectedRuleIds.size : 0}</strong> 条规则，删除 <strong>{deleteState.rules.length - (deleteState.target ? deleteState.selectedRuleIds.size : 0)}</strong> 条规则。此操作可通过编辑器“撤销”恢复。</span></div>
          {deleteError && <div className="rename-error"><CircleAlert size={14} />{deleteError}</div>}
          <div className="editor-modal-actions"><button type="button" onClick={() => setDeleteState(null)}>取消</button><button type="button" className="danger-confirm" onClick={applyDeleteGroup}>确认删除并处理关联</button></div>
        </section>
      </div>}
    </section>
  )
}
