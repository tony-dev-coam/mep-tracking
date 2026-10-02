import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { element, mockApi, model } from './test-utils'

const engine = vi.hoisted(() => {
  const state = { onSelect: (_ids: string[]) => {} }
  const viewer = {
    load: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    highlightEquipment: vi.fn(async () => {}),
    isolate: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    showAll: vi.fn(async () => {}),
    frameAll: vi.fn(async () => {}),
    frameSelection: vi.fn(async () => {}),
    dispose: vi.fn(),
    onSelect: vi.fn((h: (ids: string[]) => void) => (state.onSelect = h)),
  }
  return { state, viewer, webgl2: vi.fn(() => true) }
})

vi.mock('./viewer/engine', () => ({
  Viewer: vi.fn(function () {
    return engine.viewer
  }),
  webgl2Supported: engine.webgl2,
}))

const tree = {
  global_id: 'g-proj', name: 'Project', ifc_type: 'IfcProject', element_count: 0, children: [
    { global_id: 'g-bldg', name: 'Building', ifc_type: 'IfcBuilding', element_count: 0, children: [
      { global_id: 'g-l1', name: 'Level 01', ifc_type: 'IfcBuildingStorey', element_count: 2, children: [
        { global_id: 'g-room', name: 'Mechanical Room', ifc_type: 'IfcSpace', element_count: 1, children: [] },
      ] },
    ] },
  ],
}

const pump = element()
const ahu = element({ global_id: 'g-ahu', ifc_type: 'IfcUnitaryEquipment', name: 'AHU 01', tag: 'AHU-01', parent_global_id: 'g-room' })
const valve = element({ global_id: 'g-valve', ifc_type: 'IfcValve', name: 'Valve 01', tag: 'V-01', has_geometry: false })

function standardApi(over: Record<string, unknown> = {}) {
  return mockApi({
    '/api/projects': [{ id: 'p1', name: 'Tower A', created_at: '' }],
    '/api/projects/p1/models': [model()],
    '/api/models/m1': model(),
    '/api/models/m1/file': () => new Response(new Uint8Array([1, 2, 3])),
    '/api/models/m1/elements': [pump, ahu, valve],
    '/api/models/m1/spatial-tree': tree,
    '/api/models/m1/global-ids': (url: URL) =>
      url.searchParams.get('storey') === 'g-l1' ? ['g-l1', 'g-pump', 'g-room', 'g-ahu']
        : url.searchParams.get('parent') === 'g-room' ? ['g-ahu']
        : url.searchParams.get('equipment') === 'true' ? ['g-pump', 'g-ahu', 'g-valve'] : [],
    '/api/models/m1/elements/g-ahu': { ...ahu, properties: { Pset_ManufacturerTypeInformation: { Manufacturer: 'Trane' } }, materials: ['Steel'] },
    ...over,
  })
}

async function renderLoaded() {
  render(<App />)
  await waitFor(() => expect(engine.viewer.load).toHaveBeenCalled())
  return screen.findByRole('button', { name: /AHU-01/ })
}

beforeEach(() => {
  vi.clearAllMocks()
  engine.webgl2.mockReturnValue(true)
})
afterEach(() => vi.useRealTimers())

describe('viewer loading', () => {
  it('loads the latest processed model file into the viewer', async () => {
    standardApi()
    await renderLoaded()
    expect(engine.viewer.load).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'm1')
  })

  it('shows a placeholder instead of the viewer while processing', async () => {
    standardApi({
      '/api/projects/p1/models': [model({ status: 'processing', validation: null })],
      '/api/models/m1': model({ status: 'processing', validation: null }),
    })
    render(<App />)
    expect(await screen.findByText(/Processing…/)).toBeInTheDocument()
    expect(engine.viewer.load).not.toHaveBeenCalled()
  })

  it('shows the error for a failed model', async () => {
    standardApi({
      '/api/projects/p1/models': [model({ status: 'failed', error: 'Cannot read IFC file', validation: null })],
    })
    render(<App />)
    expect(await screen.findByText(/Cannot read IFC file/)).toBeInTheDocument()
    expect(engine.viewer.load).not.toHaveBeenCalled()
  })

  it('explains when WebGL2 is unavailable', async () => {
    engine.webgl2.mockReturnValue(false)
    standardApi()
    render(<App />)
    expect(await screen.findByText(/WebGL2 is not available/)).toBeInTheDocument()
  })
})

describe('equipment panel ↔ 3D', () => {
  it('row click selects and frames the element in 3D and shows its properties', async () => {
    standardApi()
    await userEvent.click(await renderLoaded())
    expect(engine.viewer.select).toHaveBeenCalledWith(['g-ahu'], true)
    expect(await screen.findByRole('heading', { name: 'AHU 01' })).toBeInTheDocument()
    expect(screen.getByText('Trane')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AHU-01/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('row without geometry shows a badge and selects without framing', async () => {
    standardApi()
    await renderLoaded()
    const row = screen.getByRole('button', { name: /V-01/ })
    expect(within(row).getByText('no geometry')).toBeInTheDocument()
    await userEvent.click(row)
    expect(engine.viewer.select).toHaveBeenCalledWith(['g-valve'], false)
  })

  it('selecting in 3D selects the matching row', async () => {
    standardApi()
    await renderLoaded()
    act(() => engine.state.onSelect(['g-ahu']))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /AHU-01/ })).toHaveAttribute('aria-pressed', 'true'))
    expect(engine.viewer.select).not.toHaveBeenCalled() // no echo back into the viewer
  })

  it('selecting a non-equipment element in 3D clears the row and shows "No data" when unknown', async () => {
    standardApi()
    await userEvent.click(await renderLoaded())
    act(() => engine.state.onSelect(['g-unknown']))
    expect(await screen.findByText('No data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AHU-01/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('search filters by name, tag, type, and storey', async () => {
    standardApi()
    await renderLoaded()
    const search = screen.getByRole('searchbox', { name: 'Search equipment' })
    await userEvent.type(search, 'valve')
    expect(screen.queryByRole('button', { name: /AHU-01/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /V-01/ })).toBeInTheDocument()
    await userEvent.clear(search)
    await userEvent.type(search, 'unitary')
    expect(screen.getByRole('button', { name: /AHU-01/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /P-01/ })).not.toBeInTheDocument()
    await userEvent.clear(search)
    await userEvent.type(search, 'level 01')
    expect(screen.getAllByRole('button', { name: /P-01|AHU-01|V-01/ })).toHaveLength(3)
  })
})

describe('toolbar', () => {
  it('highlights all equipment, isolates and hides the selection, shows all', async () => {
    standardApi()
    await userEvent.click(await renderLoaded())
    await userEvent.click(screen.getByRole('button', { name: 'Highlight equipment' }))
    expect(engine.viewer.highlightEquipment).toHaveBeenCalledWith(['g-pump', 'g-ahu', 'g-valve'])
    await userEvent.click(screen.getByRole('button', { name: 'Highlight equipment' }))
    expect(engine.viewer.highlightEquipment).toHaveBeenLastCalledWith(null)
    await userEvent.click(screen.getByRole('button', { name: 'Isolate selection' }))
    expect(engine.viewer.isolate).toHaveBeenCalledWith(['g-ahu'])
    await userEvent.click(screen.getByRole('button', { name: 'Hide selection' }))
    expect(engine.viewer.hide).toHaveBeenCalledWith(['g-ahu'])
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(engine.viewer.showAll).toHaveBeenCalled()
  })

  it('selection actions are disabled with nothing selected', async () => {
    standardApi()
    await renderLoaded()
    expect(screen.getByRole('button', { name: 'Isolate selection' })).toBeDisabled()
  })
})

describe('spatial tree → 3D', () => {
  it('storey click isolates that storey; space click isolates the space contents', async () => {
    standardApi()
    await renderLoaded()
    const tree = await screen.findByRole('region', { name: 'Spatial structure' })
    await userEvent.click(within(tree).getByRole('button', { name: /Level 01/ }))
    expect(engine.viewer.isolate).toHaveBeenCalledWith(['g-l1', 'g-pump', 'g-room', 'g-ahu'])
    await userEvent.click(within(tree).getByRole('button', { name: /Mechanical Room/ }))
    expect(engine.viewer.isolate).toHaveBeenLastCalledWith(['g-ahu'])
  })
})

describe('validation report', () => {
  it('lists checks with severity and counts', async () => {
    standardApi()
    await renderLoaded()
    const report = screen.getByRole('region', { name: 'Validation' })
    expect(within(report).getByText(/Equipment without manufacturer/)).toBeInTheDocument()
    expect(within(report).getByText('1 warning')).toBeInTheDocument()
    expect(within(report).getByText('1 passed')).toBeInTheDocument()
  })
})

describe('projects and uploads', () => {
  it('creates a project', async () => {
    const api = mockApi({
      '/api/projects': [],
      'POST /api/projects': { id: 'p2', name: 'Plant B', created_at: '' },
      '/api/projects/p2/models': [],
    })
    render(<App />)
    await userEvent.type(await screen.findByRole('textbox', { name: 'New project' }), 'Plant B')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('option', { name: 'Plant B' })).toBeInTheDocument()
    expect(api).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' }))
  })

  it('shows the API error when creating a duplicate project', async () => {
    mockApi({
      '/api/projects': [],
      'POST /api/projects': () => new Response(JSON.stringify({ error: 'Project name already exists' }), { status: 409 }),
    })
    render(<App />)
    await userEvent.type(await screen.findByRole('textbox', { name: 'New project' }), 'Tower A')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Project name already exists')
  })

  it('keeps a model uploaded while the new project\'s model list is still loading', async () => {
    let releaseList: (v: unknown) => void = () => {}
    const slowList = new Promise((r) => (releaseList = r))
    let uploaded = false
    mockApi({
      '/api/projects': [],
      'POST /api/projects': { id: 'p2', name: 'Plant B', created_at: '' },
      // First (slow) list call returns the stale empty list after the upload has finished.
      '/api/projects/p2/models': async () => (uploaded ? [model({ project_id: 'p2', status: 'processing', validation: null })] : (await slowList, [])),
      'POST /api/projects/p2/models': () => {
        uploaded = true
        return model({ project_id: 'p2', status: 'processing', validation: null })
      },
      '/api/models/m1': model({ status: 'processing', validation: null }),
    })
    render(<App />)
    await userEvent.type(await screen.findByRole('textbox', { name: 'New project' }), 'Plant B')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await userEvent.upload(screen.getByLabelText('Upload IFC'), new File(['x'], 'demo.ifc'))
    await act(async () => releaseList(null))
    expect(await screen.findByRole('status', { name: 'v1 status' })).toHaveTextContent('processing')
  })

  it('uploads and polls status every 2 s until processed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let status = 'processing'
    let models: unknown[] = []
    mockApi({
      '/api/projects': [{ id: 'p1', name: 'Tower A', created_at: '' }],
      '/api/projects/p1/models': () => models,
      'POST /api/projects/p1/models': () => {
        models = [model({ status: 'processing', validation: null })]
        return models[0]
      },
      '/api/models/m1': () => model({ status }),
      '/api/models/m1/file': () => new Response(new Uint8Array([1])),
      '/api/models/m1/elements': [],
      '/api/models/m1/spatial-tree': tree,
    })
    render(<App />)
    const input = await screen.findByLabelText('Upload IFC')
    await userEvent.upload(input, new File(['x'], 'demo.ifc'))
    expect(await screen.findByText(/Processing…/)).toBeInTheDocument()
    status = 'processed'
    await act(() => vi.advanceTimersByTimeAsync(2000))
    await waitFor(() => expect(engine.viewer.load).toHaveBeenCalled())
    expect(screen.getByRole('status', { name: 'v1 status' })).toHaveTextContent('processed')
  })
})

describe('keyboard shortcuts', () => {
  it('I/H/A/Esc act on the selection; F and Shift+F frame', async () => {
    standardApi()
    await userEvent.click(await renderLoaded())
    await userEvent.keyboard('i')
    expect(engine.viewer.isolate).toHaveBeenLastCalledWith(['g-ahu'])
    await userEvent.keyboard('h')
    expect(engine.viewer.hide).toHaveBeenLastCalledWith(['g-ahu'])
    await userEvent.keyboard('a')
    expect(engine.viewer.showAll).toHaveBeenCalled()
    await userEvent.keyboard('f')
    expect(engine.viewer.frameAll).toHaveBeenCalled()
    await userEvent.keyboard('F')
    expect(engine.viewer.frameSelection).toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(engine.viewer.select).toHaveBeenLastCalledWith([], false)
    expect(screen.getByText(/Select equipment in the schedule/)).toBeInTheDocument()
  })

  it('ignores shortcuts while typing in a field', async () => {
    standardApi()
    await userEvent.click(await renderLoaded())
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search equipment' }), 'ahi')
    expect(engine.viewer.showAll).not.toHaveBeenCalled()
    expect(engine.viewer.isolate).not.toHaveBeenCalled()
    expect(engine.viewer.hide).not.toHaveBeenCalled()
  })

  it('selection shortcuts do nothing without a selection', async () => {
    standardApi()
    await renderLoaded()
    await userEvent.keyboard('i')
    expect(engine.viewer.isolate).not.toHaveBeenCalled()
  })
})

describe('storey navigator', () => {
  it('isolates a storey, releases on second click, and steps with next/previous', async () => {
    standardApi({
      '/api/models/m1/spatial-tree': { ...tree, children: [{ ...tree.children[0], children: [
        tree.children[0].children[0],
        { global_id: 'g-l2', name: 'Level 02', ifc_type: 'IfcBuildingStorey', element_count: 1, children: [] },
      ] }] },
      '/api/models/m1/global-ids': (url: URL) =>
        url.searchParams.get('storey') === 'g-l1' ? ['g-l1', 'g-pump']
          : url.searchParams.get('storey') === 'g-l2' ? ['g-l2', 'g-valve'] : [],
    })
    await renderLoaded()
    const nav = await screen.findByRole('region', { name: 'Storeys' })
    await userEvent.click(within(nav).getByRole('button', { name: 'Level 01' }))
    expect(engine.viewer.isolate).toHaveBeenLastCalledWith(['g-l1', 'g-pump'])
    expect(within(nav).getByRole('button', { name: 'Level 01' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(nav).getByRole('button', { name: 'Next storey' }))
    expect(engine.viewer.isolate).toHaveBeenLastCalledWith(['g-l2', 'g-valve'])
    expect(within(nav).getByRole('button', { name: 'Next storey' })).toBeDisabled()
    await userEvent.click(within(nav).getByRole('button', { name: 'Previous storey' }))
    expect(engine.viewer.isolate).toHaveBeenLastCalledWith(['g-l1', 'g-pump'])
    await userEvent.click(within(nav).getByRole('button', { name: 'Level 01' }))
    expect(engine.viewer.showAll).toHaveBeenCalledTimes(1)
    expect(within(nav).getByRole('button', { name: 'Level 01' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('does not move the camera when isolating', async () => {
    standardApi()
    await renderLoaded()
    const nav = await screen.findByRole('region', { name: 'Storeys' })
    await userEvent.click(within(nav).getByRole('button', { name: 'Level 01' }))
    expect(engine.viewer.frameAll).not.toHaveBeenCalled()
    expect(engine.viewer.frameSelection).not.toHaveBeenCalled()
  })
})

describe('validation findings', () => {
  it('clicking a finding selects and frames its elements', async () => {
    standardApi({
      '/api/projects/p1/models': [model({ validation: { summary: { pass: 0, warning: 1, error: 0 }, checks: [
        { code: 'missing_manufacturer', severity: 'WARNING', message: 'Equipment without manufacturer: 2', count: 2, global_ids: ['g-ahu', 'g-valve'] },
      ] } })],
    })
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: /Equipment without manufacturer: 2/ }))
    expect(engine.viewer.select).toHaveBeenLastCalledWith(['g-ahu', 'g-valve'], true)
    expect(await screen.findByText('2 elements selected')).toBeInTheDocument()
    await userEvent.keyboard('i')
    expect(engine.viewer.isolate).toHaveBeenLastCalledWith(['g-ahu', 'g-valve'])
  })

  it('passing checks are not clickable', async () => {
    standardApi()
    await renderLoaded()
    const report = screen.getByRole('region', { name: 'Validation' })
    expect(within(report).queryByRole('button', { name: /IFC4/ })).not.toBeInTheDocument()
    expect(within(report).getByRole('button', { name: /Equipment without manufacturer/ })).toBeInTheDocument()
  })
})
