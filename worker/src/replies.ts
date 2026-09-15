import type { PrismaClient } from '@prisma/client'
import { normalizePhone, parseReply } from '@swc/shared'
import type { ReplyIntent } from '@swc/shared'
import type { InboundMessage } from './whatsapp/driver.js'

interface Deps {
  prisma: PrismaClient
  notify: (orderId: string, action: 'confirmed' | 'cancelled') => Promise<void>
  text: InboundMessage
}

function intentFor(text: InboundMessage): ReplyIntent {
  if (text.selectedButtonId === 'confirm_order') return 'confirm'
  if (text.selectedButtonId === 'cancel_order') return 'cancel'
  return parseReply(text.body)
}

export async function handleInbound(
  deps: Deps
): Promise<'confirmed' | 'cancelled' | 'unknown' | 'ignored'> {
  const { prisma, notify, text } = deps

  const phone = normalizePhone(text.from)
  if (!phone) return 'ignored'

  const order = await prisma.order.findFirst({
    where: { phone, status: 'sent' },
    orderBy: { sentAt: 'desc' }
  })
  if (!order) return 'ignored'

  const intent = intentFor(text)
  if (intent === 'unknown') {
    await prisma.message.create({
      data: {
        orderId: order.id,
        direction: 'in',
        body: text.body || (text.selectedButtonId ?? ''),
        waMessageId: text.waMessageId
      }
    })
    return 'unknown'
  }

  const action = intent === 'confirm' ? 'confirmed' : 'cancelled'
  const now = new Date()

  await prisma.message.create({
    data: { orderId: order.id, direction: 'in', body: text.body || intent, waMessageId: text.waMessageId }
  })

  try {
    await notify(order.id, action)
  } catch {
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: action,
      ...(action === 'confirmed' ? { confirmedAt: now } : { cancelledAt: now })
    }
  })

  return action
}
