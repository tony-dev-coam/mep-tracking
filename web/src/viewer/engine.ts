/**
 * The only module that talks to That Open Engine. Everything outside speaks IFC GlobalIds;
 * conversion to fragment localIds happens here via the fragments model's GUID lookup.
 */
import * as OBC from '@thatopen/components'
import * as OBF from '@thatopen/components-front'
import type { FragmentsModel } from '@thatopen/fragments'
import * as THREE from 'three'

const SELECT = 'select'
const EQUIPMENT = 'equipment'

export type SelectHandler = (globalIds: string[]) => void

export function webgl2Supported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export class Viewer {
  private components = new OBC.Components()
  private world: OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>
  private fragments: OBC.FragmentsManager
  private highlighter: OBF.Highlighter
  private model?: FragmentsModel
  private selection: OBC.ModelIdMap | null = null
  private selectHandler: SelectHandler = () => {}

  constructor(container: HTMLElement) {
    const c = this.components
    this.world = c.get(OBC.Worlds).create()
    this.world.scene = new OBC.SimpleScene(c)
    this.world.scene.setup()
    this.world.scene.three.background = new THREE.Color(0xf4f5f7)
    this.world.renderer = new OBC.SimpleRenderer(c, container)
    this.world.camera = new OBC.OrthoPerspectiveCamera(c)
    c.init()
    c.get(OBC.Grids).create(this.world)

    this.fragments = c.get(OBC.FragmentsManager)
    // Served from /public by `npm run assets`, so no CDN is needed at runtime.
    this.fragments.init('/fragments-worker.mjs')
    this.world.camera.controls.addEventListener('rest', () => this.fragments.core.update(true))

    this.highlighter = c.get(OBF.Highlighter)
    this.highlighter.setup({
      world: this.world,
      selectName: SELECT,
      selectMaterialDefinition: {
        color: new THREE.Color(0x2f6fb5), // interface blue, matches the selected schedule row accent
        opacity: 1,
        transparent: false,
        renderedFaces: 0,
      },
    })
    this.highlighter.zoomToSelection = false
    this.highlighter.styles.set(EQUIPMENT, {
      color: new THREE.Color(0xff8a00),
      opacity: 1,
      transparent: false,
      renderedFaces: 0,
      priority: 1,
    })
    this.highlighter.events[SELECT].onHighlight.add(async (map) => {
      this.selection = map
      this.selectHandler(await this.toGlobalIds(map))
    })
    this.highlighter.events[SELECT].onClear.add(() => {
      this.selection = null
      this.selectHandler([])
    })
    container.addEventListener('dblclick', () => void this.frameSelection())
  }

  onSelect(handler: SelectHandler) {
    this.selectHandler = handler
  }

  async load(bytes: Uint8Array, name: string) {
    if (this.model) await this.fragments.core.disposeModel(this.model.modelId)
    const loader = this.components.get(OBC.IfcLoader)
    await loader.setup({ autoSetWasm: false, wasm: { path: '/wasm/', absolute: true } })
    const model = await loader.load(bytes, false, name)
    model.useCamera(this.world.camera.three)
    this.world.scene.three.add(model.object)
    await this.fragments.core.update(true)
    this.model = model
    // Camera moves animate per frame; don't block readiness on them (frames pause in hidden tabs).
    void this.world.camera.fitToItems()
  }

  /** Select elements (empty list clears) and optionally frame them. */
  async select(globalIds: string[], frame = true) {
    const map = await this.toModelIdMap(globalIds)
    this.selection = map
    if (!map) return this.highlighter.clear(SELECT)
    await this.highlighter.highlightByID(SELECT, map, true, false)
    if (frame) void this.world.camera.fitToItems(map)
  }

  // Camera moves animate per frame; not awaited (frames pause in hidden tabs).
  async frameAll() {
    void this.world.camera.fitToItems()
  }

  async frameSelection() {
    if (this.selection) void this.world.camera.fitToItems(this.selection)
  }

  async highlightEquipment(globalIds: string[] | null) {
    await this.highlighter.clear(EQUIPMENT)
    const map = globalIds && (await this.toModelIdMap(globalIds))
    if (map) await this.highlighter.highlightByID(EQUIPMENT, map, true, false)
  }

  async isolate(globalIds: string[]) {
    const map = await this.toModelIdMap(globalIds)
    if (map) await this.components.get(OBC.Hider).isolate(map)
  }

  async hide(globalIds: string[]) {
    const map = await this.toModelIdMap(globalIds)
    if (map) await this.components.get(OBC.Hider).set(false, map)
  }

  async showAll() {
    await this.components.get(OBC.Hider).set(true)
  }

  dispose() {
    this.components.dispose()
  }

  private async toModelIdMap(globalIds: string[]): Promise<OBC.ModelIdMap | null> {
    if (!this.model || globalIds.length === 0) return null
    const localIds = (await this.model.getLocalIdsByGuids(globalIds)).filter(
      (id): id is number => id !== null,
    )
    return localIds.length ? { [this.model.modelId]: new Set(localIds) } : null
  }

  private async toGlobalIds(map: OBC.ModelIdMap): Promise<string[]> {
    if (!this.model) return []
    const localIds = [...(map[this.model.modelId] ?? [])]
    return (await this.model.getGuidsByLocalIds(localIds)).filter((g): g is string => g !== null)
  }
}
