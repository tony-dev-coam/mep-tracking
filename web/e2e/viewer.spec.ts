import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const DEMO = path.resolve(import.meta.dirname, '../../samples/demo-plant.ifc')

/** Center of an element's bounding box, projected to page coordinates. Reaches viewer internals via the dev hook. */
async function screenPointOf(page: Page, globalId: string) {
  return page.evaluate(async (gid) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (window as any).__mep.viewer
    const [localId] = await v.model.getLocalIdsByGuids([gid])
    const box = await v.model.getMergedBox([localId])
    const center = box.getCenter(box.min.clone())
    const camera = v.world.camera.three
    camera.updateMatrixWorld()
    const p = center.project(camera)
    const rect = v.world.renderer.three.domElement.getBoundingClientRect()
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
  }, globalId)
}

test('upload the demo plant, inspect equipment in 3D and the schedule', async ({ page }) => {
  await page.goto('/')
  const projectName = `Demo Plant ${new Date().toISOString().slice(11, 19)}`
  await page.getByRole('textbox', { name: 'New project' }).fill(projectName)
  await page.getByRole('button', { name: 'Create' }).click()
  // Upload targets the selected project, so wait until the new one is selected.
  await expect(page.getByRole('combobox', { name: 'Project' }).locator('option:checked')).toHaveText(projectName)
  await page.getByLabel('Upload IFC').setInputFiles(DEMO)

  // Background processing, then the viewer loads the file.
  await expect(page.getByRole('status', { name: 'v1 status' })).toHaveText('processed', { timeout: 60_000 })
  await expect(page.getByText('Loading model…')).toBeHidden({ timeout: 60_000 })
  await page.waitForFunction(() => (window as any).__mep?.viewer?.model)
  await expect(page.getByText('29 of 29')).toBeVisible()

  // GlobalId round-trip for every equipment element (all have geometry in the demo).
  const roundTrip = await page.evaluate(async () => {
    const v = (window as any).__mep.viewer
    const modelId = v.model.modelId
    const eq = await fetch(`/api/models/${modelId}/global-ids?equipment=true`).then((r) => r.json())
    const local = await v.model.getLocalIdsByGuids(eq)
    const back = await v.model.getGuidsByLocalIds(local)
    return { count: eq.length, ok: back.every((g: string, i: number) => g === eq[i]) }
  })
  expect(roundTrip).toEqual({ count: 29, ok: true })

  // Schedule → 3D + title block.
  await page.getByRole('button', { name: /^CH-01/ }).click()
  await expect(page.getByRole('heading', { name: 'CH 01' })).toBeVisible()
  await page.waitForTimeout(1500) // camera frames the chiller (animated)

  // 3D → schedule: clear, then click the chiller on the canvas.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /^CH-01/ })).toHaveAttribute('aria-pressed', 'false')
  const chiller = await page.evaluate(async () => {
    const r = await fetch(`/api/models/${(window as any).__mep.viewer.model.modelId}/elements?type=IfcChiller`)
    return (await r.json())[0].global_id as string
  })
  const point = await screenPointOf(page, chiller)
  await page.mouse.click(point.x, point.y)
  await expect(page.getByRole('button', { name: /^CH-01/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'CH 01' })).toBeVisible()

  // Clickable finding selects both elements without a manufacturer.
  await page.getByRole('button', { name: 'Equipment without manufacturer: 2' }).click()
  await expect(page.getByText('2 elements selected')).toBeVisible()

  // Storey navigator isolates Level 03; A shows all again.
  const storeys = page.getByRole('region', { name: 'Storeys' })
  await storeys.getByRole('button', { name: 'Level 03' }).click()
  await expect(storeys.getByRole('button', { name: 'Level 03' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('a')
  await expect(storeys.getByRole('button', { name: 'Level 03' })).toHaveAttribute('aria-pressed', 'false')

  // README screenshot: equipment highlighted, an AHU selected.
  await page.getByRole('button', { name: 'Highlight equipment' }).click()
  await page.getByRole('button', { name: /^AHU-01/ }).click()
  await page.waitForTimeout(1500) // let the selection framing finish first
  await page.keyboard.press('f') // overview rather than the tight selection frame
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.resolve(import.meta.dirname, '../../docs/images/mep-tracking.png') })
})
