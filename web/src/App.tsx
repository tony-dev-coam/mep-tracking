import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, type Element, type ElementSummary, type IfcModel, type Project, type SpatialNode } from './api'
import { ElementPanel } from './components/ElementPanel'
import { EquipmentSchedule } from './components/EquipmentSchedule'
import { ModelList } from './components/ModelList'
import { ModelViewer } from './components/ModelViewer'
import { ProjectBar } from './components/ProjectBar'
import { SpatialTree } from './components/SpatialTree'
import { StoreyNavigator } from './components/StoreyNavigator'
import { ValidationReport } from './components/ValidationReport'
import type { Viewer } from './viewer/engine'

const POLL_MS = 2000

function storeysOf(node: SpatialNode | null): SpatialNode[] {
  if (!node) return []
  return node.ifc_type === 'IfcBuildingStorey' ? [node] : node.children.flatMap(storeysOf)
}

function storeyNamesOf(node: SpatialNode | null, out: Record<string, string> = {}) {
  if (!node) return out
  if (node.ifc_type === 'IfcBuildingStorey') out[node.global_id] = node.name ?? 'Storey'
  node.children.forEach((c) => storeyNamesOf(c, out))
  return out
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [models, setModels] = useState<IfcModel[]>([])
  const [modelId, setModelId] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<ElementSummary[]>([])
  const [tree, setTree] = useState<SpatialNode | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Details for a single selection: undefined = none, null = selected but no DB row
  const [selected, setSelected] = useState<Element | null | undefined>(undefined)
  const [isolatedId, setIsolatedId] = useState<string | null>(null) // storey/space shown alone
  const [highlighting, setHighlighting] = useState(false)
  const viewer = useRef<Viewer | null>(null)

  const model = models.find((m) => m.id === modelId) ?? null
  const storeyNames = useMemo(() => storeyNamesOf(tree), [tree])
  const storeys = useMemo(() => storeysOf(tree), [tree])

  useEffect(() => {
    api.projects().then((ps) => {
      setProjects(ps)
      setProjectId((cur) => cur ?? ps[0]?.id ?? null)
    })
  }, [])

  // Latest request wins: an upload can finish before the project's first list load returns.
  const modelsRequest = useRef(0)
  const loadModels = useCallback(async (pid: string, selectId?: string) => {
    const seq = ++modelsRequest.current
    const ms = await api.models(pid)
    if (seq !== modelsRequest.current) return
    setModels(ms)
    setModelId(selectId ?? (ms.find((m) => m.status === 'processed') ?? ms[0])?.id ?? null)
  }, [])

  useEffect(() => {
    if (projectId) void loadModels(projectId)
  }, [projectId, loadModels])

  // Poll each processing model until it settles.
  const processingIds = models.filter((m) => m.status === 'processing').map((m) => m.id).join(',')
  useEffect(() => {
    if (!processingIds) return
    const timer = setInterval(async () => {
      const fresh = await Promise.all(processingIds.split(',').map((id) => api.model(id)))
      setModels((ms) => ms.map((m) => fresh.find((f) => f.id === m.id) ?? m))
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [processingIds])

  // Load schedule + tree once the open model is processed.
  const openId = model?.status === 'processed' ? model.id : null
  useEffect(() => {
    setEquipment([])
    setTree(null)
    setSelectedIds([])
    setSelected(undefined)
    setIsolatedId(null)
    setHighlighting(false)
    if (!openId) return
    api.equipment(openId).then(setEquipment)
    api.spatialTree(openId).then(setTree).catch(() => setTree(null))
  }, [openId])

  /** Update panels for a selection. Never calls the viewer (3D selections arrive here too). */
  const showSelection = useCallback(async (ids: string[]) => {
    setSelectedIds(ids)
    setSelected(undefined)
    if (ids.length !== 1 || !openId) return
    try {
      setSelected(await api.element(openId, ids[0]))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setSelected(null)
      else throw e
    }
  }, [openId])

  const onViewerReady = useCallback((v: Viewer | null) => {
    viewer.current = v
    v?.onSelect((ids) => void showSelection(ids))
  }, [showSelection])

  function select(ids: string[], frame: boolean) {
    void showSelection(ids)
    void viewer.current?.select(ids, frame)
  }

  function selectFromSchedule(e: ElementSummary) {
    select([e.global_id], e.has_geometry)
  }

  /** Storey or space alone in 3D; the camera stays put. Clicking the shown one again shows all. */
  async function toggleIsolate(node: SpatialNode) {
    if (!openId) return
    if (node.global_id === isolatedId) return showAll()
    setIsolatedId(node.global_id)
    const filter: Record<string, string> =
      node.ifc_type === 'IfcSpace' ? { parent: node.global_id } : { storey: node.global_id }
    await viewer.current?.isolate(await api.globalIds(openId, filter))
  }

  function isolateSelection() {
    if (!selectedIds.length) return
    setIsolatedId(null)
    void viewer.current?.isolate(selectedIds)
  }

  function hideSelection() {
    if (selectedIds.length) void viewer.current?.hide(selectedIds)
  }

  function showAll() {
    setIsolatedId(null)
    void viewer.current?.showAll()
  }

  // Viewport shortcuts (keys from ifc-viewx): ignored while typing or with modifier keys.
  const shortcuts = useRef<Record<string, () => void>>({})
  shortcuts.current = {
    i: isolateSelection,
    h: hideSelection,
    a: showAll,
    f: () => void viewer.current?.frameAll(),
    F: () => void viewer.current?.frameSelection(),
    Escape: () => select([], false),
  }
  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return
      shortcuts.current[e.key]?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  async function toggleHighlight() {
    if (!openId) return
    const next = !highlighting
    setHighlighting(next)
    await viewer.current?.highlightEquipment(next ? await api.globalIds(openId, { equipment: 'true' }) : null)
  }

  async function createProject(name: string) {
    const p = await api.createProject(name)
    setProjects((ps) => [p, ...ps])
    setProjectId(p.id)
  }

  async function upload(file: File) {
    if (!projectId) return
    const m = await api.upload(projectId, file)
    await loadModels(projectId, m.id)
  }

  const selectedEquipment =
    selectedIds.length === 1 && equipment.some((e) => e.global_id === selectedIds[0]) ? selectedIds[0] : null

  return (
    <div className="app">
      <ProjectBar projects={projects} projectId={projectId} onSelect={setProjectId}
        onCreate={createProject} onUpload={upload} />
      <nav className="left">
        <ModelList models={models} selectedId={modelId} onSelect={setModelId} />
        {model && <ValidationReport model={model} onSelectIds={(ids) => select(ids, true)} />}
        {openId && <StoreyNavigator storeys={storeys} activeId={isolatedId} onToggle={toggleIsolate} />}
        {openId && <SpatialTree root={tree} activeId={isolatedId} onIsolate={toggleIsolate} />}
      </nav>
      <main className="center">
        <div className="toolbar" role="toolbar" aria-label="3D view">
          <button aria-pressed={highlighting} disabled={!openId} onClick={toggleHighlight}>
            Highlight equipment
          </button>
          <button disabled={!selectedIds.length} onClick={isolateSelection} title="I">Isolate selection</button>
          <button disabled={!selectedIds.length} onClick={hideSelection} title="H">Hide selection</button>
          <button disabled={!openId} onClick={showAll} title="A">Show all</button>
        </div>
        <ModelViewer model={model} onReady={onViewerReady} />
      </main>
      <aside className="right">
        {openId && (
          <EquipmentSchedule equipment={equipment} storeyNames={storeyNames}
            selectedId={selectedEquipment} onSelect={selectFromSchedule} />
        )}
        <ElementPanel element={selected} count={selectedIds.length}
          storeyName={selected?.storey_global_id ? storeyNames[selected.storey_global_id] : undefined} />
      </aside>
    </div>
  )
}
