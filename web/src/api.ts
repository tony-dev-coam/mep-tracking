export type Project = { id: string; name: string; created_at: string }

export type ModelStatus = 'processing' | 'processed' | 'failed'

export type Check = {
  code: string
  severity: 'PASS' | 'WARNING' | 'ERROR'
  message: string
  count: number
  global_ids: string[]
}

export type IfcModel = {
  id: string
  project_id: string
  version: number
  filename: string
  ifc_schema: string | null
  status: ModelStatus
  error: string | null
  element_count: number | null
  validation: { summary: { pass: number; warning: number; error: number }; checks: Check[] } | null
  uploaded_at: string
  processed_at: string | null
}

export type ElementSummary = {
  global_id: string
  express_id: number
  ifc_type: string
  name: string | null
  object_type: string | null
  tag: string | null
  parent_global_id: string | null
  storey_global_id: string | null
  is_spatial: boolean
  is_equipment: boolean
  has_geometry: boolean
}

export type Element = ElementSummary & {
  properties: Record<string, Record<string, unknown>>
  materials: string[]
}

export type SpatialNode = {
  global_id: string
  name: string | null
  ifc_type: string
  element_count: number
  children: SpatialNode[]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new ApiError(r.status, body?.error ?? `HTTP ${r.status}`)
  }
  return r.json()
}

const PAGE = 1000

export const api = {
  projects: () => request<Project[]>('/api/projects'),
  createProject: (name: string) =>
    request<Project>('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  models: (projectId: string) => request<IfcModel[]>(`/api/projects/${projectId}/models`),
  model: (id: string) => request<IfcModel>(`/api/models/${id}`),
  upload: (projectId: string, file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<IfcModel>(`/api/projects/${projectId}/models`, { method: 'POST', body })
  },
  file: async (id: string) => {
    const r = await fetch(`/api/models/${id}/file`)
    if (!r.ok) throw new ApiError(r.status, `HTTP ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
  },
  element: (id: string, globalId: string) =>
    request<Element>(`/api/models/${id}/elements/${encodeURIComponent(globalId)}`),
  globalIds: (id: string, filter: Record<string, string>) =>
    request<string[]>(`/api/models/${id}/global-ids?${new URLSearchParams(filter)}`),
  spatialTree: (id: string) => request<SpatialNode>(`/api/models/${id}/spatial-tree`),
  /** All equipment, fetched page by page. ponytail: fine to ~10k; server-side search beyond. */
  equipment: async (id: string) => {
    const all: ElementSummary[] = []
    for (let offset = 0; ; offset += PAGE) {
      const page = await request<ElementSummary[]>(
        `/api/models/${id}/elements?equipment=true&limit=${PAGE}&offset=${offset}`,
      )
      all.push(...page)
      if (page.length < PAGE) return all
    }
  },
}
