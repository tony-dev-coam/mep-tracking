import { vi } from 'vitest'

type Handler = unknown | ((url: URL, init?: RequestInit) => unknown)

/**
 * Stub fetch with routes keyed by "METHOD /path" (query ignored) or "/path" for GET.
 * Values are JSON bodies, Response objects, or functions returning either.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://test')
    const method = init?.method ?? 'GET'
    const key = [`${method} ${url.pathname}`, method === 'GET' ? url.pathname : null].find(
      (k) => k && k in routes,
    )
    if (!key) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    const value = routes[key]
    const result = typeof value === 'function' ? await value(url, init) : value
    return result instanceof Response ? result : new Response(JSON.stringify(result))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export const model = (over: Record<string, unknown> = {}) => ({
  id: 'm1', project_id: 'p1', version: 1, filename: 'demo.ifc', ifc_schema: 'IFC4',
  status: 'processed', error: null, element_count: 3, uploaded_at: '2026-10-02T10:00:00Z',
  processed_at: '2026-10-02T10:00:05Z',
  validation: { summary: { pass: 1, warning: 1, error: 0 }, checks: [
    { code: 'schema', severity: 'PASS', message: 'IFC4', count: 1, global_ids: [] },
    { code: 'missing_manufacturer', severity: 'WARNING', message: 'Equipment without manufacturer: 1', count: 1, global_ids: ['g-ahu'] },
  ] },
  ...over,
})

export const element = (over: Record<string, unknown> = {}) => ({
  global_id: 'g-pump', express_id: 10, ifc_type: 'IfcPump', name: 'Pump 01', object_type: null,
  tag: 'P-01', parent_global_id: 'g-l1', storey_global_id: 'g-l1', is_spatial: false,
  is_equipment: true, has_geometry: true, ...over,
})
