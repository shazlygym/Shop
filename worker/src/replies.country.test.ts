import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

process.env.USER_DEFAULT_COUNTRY_CODE = '966'

const { handleInbound } = await import('./replies.js')

const prisma = new PrismaClient()

async function seedSentOrder(phone: string) {
  return prisma.order.create({
    data: {
      shopifyOrderId: `r-country-${Math.random()}`,
      orderNumber: '#5100',
      customerName: 'Customer',
      phone,
      total: '99',
      currency: 'SAR',
      financialStatus: 'pending',
      paymentGateway: 'cod',
      status: 'sent'
    }
  })
}

describe('handleInbound with USER_DEFAULT_COUNTRY_CODE', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
  })

  afterEach(async () => {
    await prisma.message.deleteMany()
    await prisma.messageJob.deleteMany()
    await prisma.order.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('matches an order stored with the configured non-default country code', async () => {
    const order = await seedSentOrder('+966501234567')
    const notify = vi.fn().mockResolvedValue(undefined)

    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '0501234567', body: '1', waMessageId: 'in.sa.1' }
    })

    expect(result).toBe('confirmed')
    expect(notify).toHaveBeenCalledWith(order.id, 'confirmed')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('confirmed')
  })
})
