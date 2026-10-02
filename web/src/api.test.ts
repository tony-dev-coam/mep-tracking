import { expect, it } from 'vitest'
import { api } from './api'
import { element, mockApi } from './test-utils'

it('fetches every page of equipment', async () => {
  const total = 2345
  const fetchMock = mockApi({
    '/api/models/m1/elements': (url: URL) => {
      const offset = Number(url.searchParams.get('offset'))
      const n = Math.max(0, Math.min(1000, total - offset))
      return Array.from({ length: n }, (_, i) => element({ global_id: `g${offset + i}` }))
    },
  })
  const all = await api.equipment('m1')
  expect(all).toHaveLength(total)
  expect(new Set(all.map((e) => e.global_id)).size).toBe(total)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('surfaces the API error message', async () => {
  mockApi({ '/api/models/m1': () => new Response(JSON.stringify({ error: 'Model not found' }), { status: 404 }) })
  await expect(api.model('m1')).rejects.toMatchObject({ status: 404, message: 'Model not found' })
})
