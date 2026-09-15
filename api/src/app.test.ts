import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app.js'

describe('app', () => {
  it('responds to the health check', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
