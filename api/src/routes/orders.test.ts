import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'

const prisma = new PrismaClient()

describe('orders routes', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.messageJob.deleteMany()
    await prisma.message.deleteMany()
    await prisma.order.deleteMany()
    await prisma.order.create({
      data: {
        shopifyOrderId: '7770001',
        orderNumber: '#2001',
        customerName: 'Mona',
        phone: '+201000000001',
        total: '100.00',
        currency: 'EGP',
        financialStatus: 'pending',
        paymentGateway: 'cod',
        status: 'sent'
      }
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('lists orders with a status filter', async () => {
    const res = await request(createApp()).get('/api/orders?status=sent')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].orderNumber).toBe('#2001')
  })

  it('searches by phone', async () => {
    const res = await request(createApp()).get('/api/orders?q=000000001')
    expect(res.body.items).toHaveLength(1)
  })

  it('resends by creating a new pending job', async () => {
    const order = await prisma.order.findUnique({ where: { shopifyOrderId: '7770001' } })
    const res = await request(createApp()).post(`/api/orders/${order!.id}/resend`)
    expect(res.status).toBe(200)

    const job = await prisma.messageJob.findFirst({ where: { orderId: order!.id, status: 'pending' } })
    expect(job).not.toBeNull()
    const updated = await prisma.order.findUnique({ where: { id: order!.id } })
    expect(updated?.status).toBe('pending')
  })

  it('returns 404 when resending an unknown order', async () => {
    const res = await request(createApp()).post('/api/orders/nope/resend')
    expect(res.status).toBe(404)
  })
})
