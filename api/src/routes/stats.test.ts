import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'

const prisma = new PrismaClient()

async function seed(orderId: string, status: string) {
  await prisma.order.create({
    data: {
      shopifyOrderId: orderId,
      orderNumber: `#${orderId}`,
      customerName: 'x',
      phone: `+2010${orderId}`,
      total: '1',
      currency: 'EGP',
      financialStatus: 'pending',
      paymentGateway: 'cod',
      status
    }
  })
}

describe('stats route', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.order.deleteMany()
    await seed('9001', 'confirmed')
    await seed('9002', 'confirmed')
    await seed('9003', 'cancelled')
    await seed('9004', 'sent')
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns counts and confirmation rate', async () => {
    const res = await request(createApp()).get('/api/stats')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(4)
    expect(res.body.confirmed).toBe(2)
    expect(res.body.cancelled).toBe(1)
    expect(res.body.confirmationRate).toBe(0.67)
  })
})
