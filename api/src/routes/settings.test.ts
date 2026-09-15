import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'

const prisma = new PrismaClient()

describe('settings route', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.settings.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('creates defaults on first read and masks secrets', async () => {
    const res = await request(createApp()).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.messageTemplate).toContain('{{orderNumber}}')
    expect(res.body.adminAccessToken).toBe('')
  })

  it('stores a new token and masks it on the next read', async () => {
    await request(createApp())
      .put('/api/settings')
      .send({ adminAccessToken: 'shpat_secret', shopDomain: 'demo.myshopify.com' })

    const res = await request(createApp()).get('/api/settings')
    expect(res.body.adminAccessToken).toBe('********')
    expect(res.body.shopDomain).toBe('demo.myshopify.com')
  })

  it('leaves a secret unchanged when the masked value is submitted', async () => {
    await request(createApp()).put('/api/settings').send({ adminAccessToken: '********' })
    const stored = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(stored?.adminAccessToken).toBe('shpat_secret')
  })

  it('stores a new webhook secret and masks it on the next read', async () => {
    await request(createApp()).put('/api/settings').send({ webhookSecret: 'whsec_secret' })

    const res = await request(createApp()).get('/api/settings')
    expect(res.body.webhookSecret).toBe('********')
  })

  it('leaves the webhook secret unchanged when the masked value is submitted', async () => {
    await request(createApp()).put('/api/settings').send({ webhookSecret: '********' })
    const stored = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(stored?.webhookSecret).toBe('whsec_secret')
  })

  it('updates the template and the buttons toggle', async () => {
    await request(createApp()).put('/api/settings').send({ messageTemplate: 'hi {{orderNumber}}', interactiveButtons: false })
    const stored = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(stored?.messageTemplate).toBe('hi {{orderNumber}}')
    expect(stored?.interactiveButtons).toBe(false)
  })
})
