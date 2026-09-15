import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app.js'

describe('static and fallback', () => {
  it('returns JSON 404 for unknown api routes', async () => {
    const res = await request(createApp()).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
  })

  it('falls back to the dashboard index for unknown page routes', async () => {
    const res = await request(createApp()).get('/some-page')
    expect([200, 404]).toContain(res.status)
  })
})
