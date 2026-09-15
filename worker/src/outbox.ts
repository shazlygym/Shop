import type { PrismaClient } from '@prisma/client'
import { renderConfirmation } from '@swc/shared'
import type { WhatsAppDriver } from './whatsapp/driver.js'

export const MAX_ATTEMPTS = 5
const STUCK_AFTER_MS = 5 * 60 * 1000

interface Deps {
  prisma: PrismaClient
  driver: WhatsAppDriver
}

function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * 1000
}

export async function processNextJob(deps: Deps): Promise<'idle' | 'sent' | 'failed' | 'empty-phone'> {
  const { prisma, driver } = deps
  const now = new Date()

  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS)
  const job = await prisma.messageJob.findFirst({
    where: {
      scheduledAt: { lte: now },
      OR: [
        { status: 'pending' },
        { status: 'processing', updatedAt: { lt: stuckBefore } }
      ]
    },
    orderBy: { scheduledAt: 'asc' },
    include: { order: true }
  })

  if (!job) return 'idle'

  if (job.status === 'pending') {
    await prisma.messageJob.update({ where: { id: job.id }, data: { status: 'processing' } })
  }

  const order = job.order

  if (!order.phone) {
    await prisma.messageJob.update({
      where: { id: job.id },
      data: { status: 'failed', lastError: 'missing phone' }
    })
    await prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } })
    return 'empty-phone'
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  const template = settings?.messageTemplate || 'Order {{orderNumber}}'
  const body = renderConfirmation(template, {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    total: order.total,
    currency: order.currency
  })

  const buttons = (settings?.interactiveButtons ?? true)
    ? [
        { id: 'confirm_order', label: 'تأكيد الطلب' },
        { id: 'cancel_order', label: 'إلغاء الطلب' }
      ]
    : undefined

  try {
    const result = await driver.send({ to: order.phone, body, buttons })
    const sentAt = new Date()

    await prisma.message.create({
      data: { orderId: order.id, direction: 'out', body, waMessageId: result.waMessageId }
    })
    await prisma.messageJob.update({ where: { id: job.id }, data: { status: 'sent', lastError: null } })
    await prisma.order.update({ where: { id: order.id }, data: { status: 'sent', sentAt } })
    return 'sent'
  } catch (error) {
    const attempts = job.attempts + 1
    const message = error instanceof Error ? error.message : String(error)

    if (attempts >= MAX_ATTEMPTS) {
      await prisma.messageJob.update({
        where: { id: job.id },
        data: { status: 'failed', attempts, lastError: message }
      })
      await prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } })
      return 'failed'
    }

    await prisma.messageJob.update({
      where: { id: job.id },
      data: {
        status: 'pending',
        attempts,
        lastError: message,
        scheduledAt: new Date(Date.now() + backoffMs(attempts))
      }
    })
    return 'failed'
  }
}
