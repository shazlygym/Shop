import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { processNextJob, MAX_ATTEMPTS } from './outbox.js'
import type { WhatsAppDriver } from './whatsapp/driver.js'

const prisma = new PrismaClient()

function fakeDriver(overrides: Partial<WhatsAppDriver> = {}): WhatsAppDriver {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn().mockResolvedValue({ waMessageId: 'wamid.1' }),
    onInbound: vi.fn(),
    onStatus: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    requestReconnect: vi.fn(),
    ...overrides
  }
}

async function seedOrder(phone: string) {
  const order = await prisma.order.create({
    data: {
      shopifyOrderId: `o-${Math.random()}`,
      orderNumber: '#1',
      customerName: 'Test',
      phone,
      total: '10',
      currency: 'EGP',
      financialStatus: 'pending',
      paymentGateway: 'cod',
      status: 'pending'
    }
  })
  await prisma.messageJob.create({ data: { orderId: order.id, status: 'pending' } })
  return order
}

describe('processNextJob', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, messageTemplate: 'Order {{orderNumber}} total {{total}}', interactiveButtons: true },
      update: { messageTemplate: 'Order {{orderNumber}} total {{total}}', interactiveButtons: true }
    })
  })

  afterEach(async () => {
    await prisma.messageJob.deleteMany()
    await prisma.message.deleteMany()
    await prisma.order.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns idle when there is nothing to do', async () => {
    expect(await processNextJob({ prisma, driver: fakeDriver() })).toBe('idle')
  })

  it('sends a confirmation and marks the order sent', async () => {
    const order = await seedOrder('+201000000010')
    const driver = fakeDriver()
    expect(await processNextJob({ prisma, driver })).toBe('sent')

    expect(driver.send).toHaveBeenCalledOnce()
    const arg = (driver.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.to).toBe('+201000000010')
    expect(arg.body).toContain('#1')
    expect(arg.buttons?.map((b: { id: string }) => b.id)).toEqual(['confirm_order', 'cancel_order'])

    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('sent')
    expect(updated?.sentAt).not.toBeNull()
  })

  it('retries with backoff on failure', async () => {
    await seedOrder('+201000000011')
    const driver = fakeDriver({ send: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await processNextJob({ prisma, driver })).toBe('failed')

    const job = await prisma.messageJob.findFirst()
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(1)
    expect(job?.lastError).toContain('boom')
    expect(job!.scheduledAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('gives up after the maximum attempts', async () => {
    const order = await seedOrder('+201000000012')
    await prisma.messageJob.updateMany({ data: { attempts: MAX_ATTEMPTS - 1 } })
    const driver = fakeDriver({ send: vi.fn().mockRejectedValue(new Error('boom')) })
    await processNextJob({ prisma, driver })

    const job = await prisma.messageJob.findFirst()
    expect(job?.status).toBe('failed')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('failed')
  })

  it('reclaims a job stuck in processing', async () => {
    const order = await seedOrder('+201000000013')
    await prisma.messageJob.updateMany({
      data: { status: 'processing', updatedAt: new Date(Date.now() - 6 * 60 * 1000) }
    })
    const driver = fakeDriver()
    expect(await processNextJob({ prisma, driver })).toBe('sent')

    const job = await prisma.messageJob.findFirst()
    expect(job?.status).toBe('sent')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('sent')
  })

  it('fails an order with no phone number', async () => {
    const order = await seedOrder('')
    expect(await processNextJob({ prisma, driver: fakeDriver() })).toBe('empty-phone')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('failed')
  })
})
