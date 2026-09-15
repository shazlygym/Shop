import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { handleInbound } from './replies.js'

const prisma = new PrismaClient()

async function seedSentOrder(phone: string) {
  const order = await prisma.order.create({
    data: {
      shopifyOrderId: `r-${Math.random()}`,
      orderNumber: '#5001',
      customerName: 'Customer',
      phone,
      total: '99',
      currency: 'EGP',
      financialStatus: 'pending',
      paymentGateway: 'cod',
      status: 'sent'
    }
  })
  return order
}

describe('handleInbound', () => {
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

  it('confirms a sent order from the number 1', async () => {
    const order = await seedSentOrder('+201000000020')
    const notify = vi.fn().mockResolvedValue(undefined)

    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201000000020', body: '1', waMessageId: 'in.1' }
    })

    expect(result).toBe('confirmed')
    expect(notify).toHaveBeenCalledWith(order.id, 'confirmed')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('confirmed')
    expect(updated?.confirmedAt).not.toBeNull()
  })

  it('cancels via a selected button id even with an unrelated body', async () => {
    const order = await seedSentOrder('+201000000021')
    const notify = vi.fn().mockResolvedValue(undefined)

    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201000000021', body: '', waMessageId: 'in.2', selectedButtonId: 'cancel_order' }
    })

    expect(result).toBe('cancelled')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('cancelled')
  })

  it('matches an order stored in local format', async () => {
    await seedSentOrder('+201000000022')
    const notify = vi.fn().mockResolvedValue(undefined)
    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '01000000022', body: 'تأكيد', waMessageId: 'in.3' }
    })
    expect(result).toBe('confirmed')
  })

  it('ignores an unknown sender', async () => {
    const notify = vi.fn()
    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201999999999', body: '1', waMessageId: 'in.4' }
    })
    expect(result).toBe('ignored')
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores an unrecognized reply but records it', async () => {
    const order = await seedSentOrder('+201000000023')
    const notify = vi.fn()
    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201000000023', body: 'hello?', waMessageId: 'in.5' }
    })
    expect(result).toBe('unknown')
    expect(notify).not.toHaveBeenCalled()
    const messages = await prisma.message.findMany({ where: { orderId: order.id } })
    expect(messages).toHaveLength(1)
  })

  it('still persists the reply and updates the order when notify throws', async () => {
    const order = await seedSentOrder('+201000000024')
    const notify = vi.fn().mockRejectedValue(new Error('shopify down'))

    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201000000024', body: '1', waMessageId: 'in.6' }
    })

    expect(result).toBe('confirmed')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('confirmed')
    expect(updated?.confirmedAt).not.toBeNull()
    const messages = await prisma.message.findMany({ where: { orderId: order.id } })
    expect(messages).toHaveLength(1)
  })
})
