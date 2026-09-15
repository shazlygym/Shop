import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import type { WaConnectionStatus } from '@swc/shared'
import { createBot } from './bot.js'
import type { WhatsAppDriver, InboundMessage } from './whatsapp/driver.js'

const prisma = new PrismaClient()

function makeDriver() {
  let inbound: ((m: InboundMessage) => void) | null = null
  let status: ((s: WaConnectionStatus, qr?: string | null, n?: string | null) => void) | null = null
  const driver: WhatsAppDriver = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ waMessageId: 'x' }),
    onInbound: (h) => { inbound = h },
    onStatus: (h) => { status = h },
    isReady: vi.fn().mockReturnValue(true),
    requestReconnect: vi.fn()
  }
  return { driver, emitInbound: (m: InboundMessage) => inbound?.(m), emitStatus: (s: WaConnectionStatus) => status?.(s) }
}

describe('createBot', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, messageTemplate: 'Order {{orderNumber}}' },
      update: { messageTemplate: 'Order {{orderNumber}}' }
    })
  })

  afterEach(async () => {
    await prisma.message.deleteMany()
    await prisma.messageJob.deleteMany()
    await prisma.order.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('pushes status updates to the api', async () => {
    const { driver, emitStatus } = makeDriver()
    const pushStatus = vi.fn().mockResolvedValue(undefined)
    const bot = createBot({ prisma, driver, notify: vi.fn(), pushStatus })
    bot.start(100000)

    emitStatus('ready')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pushStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
    bot.stop()
  })

  it('processes a pending job on the loop', async () => {
    const order = await prisma.order.create({
      data: {
        shopifyOrderId: 'bot-1',
        orderNumber: '#1',
        customerName: 'x',
        phone: '+201000000030',
        total: '1',
        currency: 'EGP',
        financialStatus: 'pending',
        paymentGateway: 'cod',
        status: 'pending'
      }
    })
    await prisma.messageJob.create({ data: { orderId: order.id, status: 'pending' } })

    const { driver } = makeDriver()
    const bot = createBot({ prisma, driver, notify: vi.fn(), pushStatus: vi.fn() })
    bot.start(50)

    await new Promise((resolve) => setTimeout(resolve, 200))
    bot.stop()

    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('sent')
  })
})
