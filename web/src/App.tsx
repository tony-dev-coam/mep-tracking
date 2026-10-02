import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api, type Element, type ElementSummary, type IfcModel, type Project, type SpatialNode } from './api'
import { ElementPanel } from './components/ElementPanel'
import { EquipmentSchedule } from './components/EquipmentSchedule'
import { ModelList } from './components/ModelList'
import { ModelViewer } from './components/ModelViewer'
import { ProjectBar } from './components/ProjectBar'
import { SpatialTree } from './components/SpatialTree'
import { ValidationReport } from './components/ValidationReport'
import type { Viewer } from './viewer/engine'

const POLL_MS = 2000

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // undefined = nothing selected, null = selected but no DB row
  const [selected, setSelected] = useState<Element | null | undefined>(undefined)
  const [highlighting, setHighlighting] = useState(false)
  const viewer = useRef<Viewer | null>(null)

  const model = models.find((m) => m.id === modelId) ?? null
  const storeyNames = useMemo(() => storeyNamesOf(tree), [tree])

  useEffect(() => {
    api.projects().then((ps) => {
      setProjects(ps)
      setProjectId((cur) => cur ?? ps[0]?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!projectId) return
    api.models(projectId).then((ms) => {
      setModels(ms)
      setModelId((ms.find((m) => m.status === 'processed') ?? ms[0])?.id ?? null)
    })
  }, [projectId])

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
    setSelectedId(null)
    setSelected(undefined)
    setHighlighting(false)
    if (!openId) return
    api.equipment(openId).then(setEquipment)
    api.spatialTree(openId).then(setTree).catch(() => setTree(null))
  }, [openId])

  const showElement = useCallback(async (globalId: string | null) => {
    setSelectedId(globalId)
    if (!globalId || !openId) return setSelected(undefined)
    try {
      setSelected(await api.element(openId, globalId))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setSelected(null)
      else throw e
    }
  }, [openId])

  const onViewerReady = useCallback((v: Viewer | null) => {
    viewer.current = v
    v?.onSelect((gid) => void showElement(gid)) // from 3D: update panels, never echo back
  }, [showElement])

  function selectFromSchedule(e: ElementSummary) {
    void showElement(e.global_id)
    void viewer.current?.select(e.global_id, e.has_geometry)
  }

  async function isolateNode(node: SpatialNode) {
    if (!openId) return
    const filter: Record<string, string> =
      node.ifc_type === 'IfcSpace' ? { parent: node.global_id } : { storey: node.global_id }
    await viewer.current?.isolate(await api.globalIds(openId, filter))
  }

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
    setModels((ms) => [m, ...ms])
    setModelId(m.id)
  }

  const selectedEquipment = equipment.some((e) => e.global_id === selectedId) ? selectedId : null

  return (
    <div className="app">
      <ProjectBar projects={projects} projectId={projectId} onSelect={setProjectId}
        onCreate={createProject} onUpload={upload} />
      <nav className="left">
        <ModelList models={models} selectedId={modelId} onSelect={setModelId} />
        {model && <ValidationReport model={model} />}
        {openId && <SpatialTree root={tree} onIsolate={isolateNode} />}
      </nav>
      <main className="center">
        <div className="toolbar" role="toolbar" aria-label="3D view">
          <button aria-pressed={highlighting} disabled={!openId} onClick={toggleHighlight}>
            Highlight equipment
          </button>
          <button disabled={!selectedId} onClick={() => selectedId && viewer.current?.isolate([selectedId])}>
            Isolate selection
          </button>
          <button disabled={!selectedId} onClick={() => selectedId && viewer.current?.hide([selectedId])}>
            Hide selection
          </button>
          <button disabled={!openId} onClick={() => viewer.current?.showAll()}>Show all</button>
        </div>
        <ModelViewer model={model} onReady={onViewerReady} />
      </main>
      <aside className="right">
        {openId && (
          <EquipmentSchedule equipment={equipment} storeyNames={storeyNames}
            selectedId={selectedEquipment} onSelect={selectFromSchedule} />
        )}
        <ElementPanel element={selected}
          storeyName={selected?.storey_global_id ? storeyNames[selected.storey_global_id] : undefined} />
      </aside>
    </div>
  )
}
