import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { computeShopifyHmac } from '@swc/shared'
import { createApp } from '../app.js'

const prisma = new PrismaClient()
const SECRET = 'test-secret'

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: 5550001,
    name: '#1001',
    currency: 'EGP',
    total_price: '250.00',
    financial_status: 'pending',
    payment_gateway_names: ['Cash on Delivery (COD)'],
    phone: '01012345678',
    customer: { first_name: 'Ahmed', last_name: 'Ali' },
    ...overrides
  }
}

function post(body: unknown) {
  const raw = JSON.stringify(body)
  const hmac = computeShopifyHmac(raw, SECRET)
  return request(createApp())
    .post('/webhooks/shopify/orders')
    .set('Content-Type', 'application/json')
    .set('x-shopify-hmac-sha256', hmac)
    .send(raw)
}

describe('shopify orders webhook', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.messageJob.deleteMany()
    await prisma.order.deleteMany()
    await prisma.webhookEvent.deleteMany()
    await prisma.settings.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('creates an order and a pending job for a COD order', async () => {
    const res = await post(payload())
    expect(res.status).toBe(200)

    const order = await prisma.order.findUnique({ where: { shopifyOrderId: '5550001' } })
    expect(order).not.toBeNull()
    expect(order?.phone).toBe('+201012345678')
    expect(order?.status).toBe('pending')

    const job = await prisma.messageJob.findFirst({ where: { orderId: order!.id } })
    expect(job?.status).toBe('pending')
  })

  it('is idempotent for a repeated webhook', async () => {
    const first = await post(payload({ id: 5550002 }))
    expect(first.status).toBe(200)

    const second = await post(payload({ id: 5550002 }))
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ skipped: 'duplicate' })

    const count = await prisma.order.count({ where: { shopifyOrderId: '5550002' } })
    expect(count).toBe(1)

    const order = await prisma.order.findUnique({ where: { shopifyOrderId: '5550002' } })
    const jobs = await prisma.messageJob.count({ where: { orderId: order!.id } })
    expect(jobs).toBe(1)
  })

  it('falls back to shipping_address phone when the top-level phone is empty', async () => {
    const res = await post(payload({ id: 5550004, phone: '', shipping_address: { phone: '01098765432' } }))
    expect(res.status).toBe(200)

    const order = await prisma.order.findUnique({ where: { shopifyOrderId: '5550004' } })
    expect(order).not.toBeNull()
    expect(order?.phone).toBe('+201098765432')
    expect(order?.status).toBe('pending')

    const job = await prisma.messageJob.findFirst({ where: { orderId: order!.id } })
    expect(job?.status).toBe('pending')
  })

  it('ignores non-COD orders', async () => {
    await post(payload({ id: 5550003, payment_gateway_names: ['shopify_payments'] }))
    const count = await prisma.order.count({ where: { shopifyOrderId: '5550003' } })
    expect(count).toBe(0)
  })

  it('rejects a bad signature', async () => {
    const res = await request(createApp())
      .post('/webhooks/shopify/orders')
      .set('Content-Type', 'application/json')
      .set('x-shopify-hmac-sha256', 'deadbeef')
      .send('{"id":1}')
    expect(res.status).toBe(401)
  })
})
