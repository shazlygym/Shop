import { describe, expect, it, vi } from 'vitest'
import { createShopifyClient } from './client.js'

describe('shopify client', () => {
  it('adds tags with the tagsAdd mutation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tagsAdd: { userErrors: [] } } })
    })
    const client = createShopifyClient({ shopDomain: 's.myshopify.com', adminToken: 't', fetchImpl })
    await client.addTags('123', ['confirmed-by-whatsapp'])

    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toContain('s.myshopify.com/admin/api/2024-07/graphql.json')
    const body = JSON.parse(String(init.body))
    expect(body.query).toContain('tagsAdd')
    expect(body.variables).toEqual({ id: 'gid://shopify/Order/123', tags: ['confirmed-by-whatsapp'] })
  })

  it('appends a note after reading the existing note', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { order: { note: 'old line' } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { orderUpdate: { userErrors: [] } } }) })

    const client = createShopifyClient({ shopDomain: 's.myshopify.com', adminToken: 't', fetchImpl })
    await client.appendNote('123', 'new line')

    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1].body))
    expect(secondBody.variables.input.note).toBe('old line\nnew line')
  })

  it('throws when Shopify returns user errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tagsAdd: { userErrors: [{ message: 'bad' }] } } })
    })
    const client = createShopifyClient({ shopDomain: 's.myshopify.com', adminToken: 't', fetchImpl })
    await expect(client.addTags('123', ['x'])).rejects.toThrow('bad')
  })
})
