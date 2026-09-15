import type { PrismaClient } from '@prisma/client'
import type { WaConnectionStatus } from '@swc/shared'
import { processNextJob } from './outbox.js'
import { handleInbound } from './replies.js'
import type { WhatsAppDriver } from './whatsapp/driver.js'

export type Notifier = (orderId: string, action: 'confirmed' | 'cancelled') => Promise<void>

interface StatusPayload {
  status: WaConnectionStatus
  qr?: string | null
  number?: string | null
}

interface BotDeps {
  prisma: PrismaClient
  driver: WhatsAppDriver
  notify: Notifier
  pushStatus?: (payload: StatusPayload) => Promise<void>
}

export function createBot(deps: BotDeps) {
  const { prisma, driver, notify, pushStatus } = deps
  let timer: NodeJS.Timeout | null = null
  let running = false

  driver.onInbound((message) => {
    void handleInbound({ prisma, notify, text: message }).catch((error) => {
      console.error('[worker] inbound handling failed', error)
    })
  })

  driver.onStatus((status, qr, number) => {
    void pushStatus?.({ status, qr, number }).catch(() => undefined)
  })

  async function tick(): Promise<void> {
    if (running) return
    if (!driver.isReady()) return
    running = true
    try {
      let result = await processNextJob({ prisma, driver })
      while (result === 'sent' || result === 'failed' || result === 'empty-phone') {
        result = await processNextJob({ prisma, driver })
      }
    } catch (error) {
      console.error('[worker] outbox error', error)
    } finally {
      running = false
    }
  }

  return {
    start(intervalMs = 1500) {
      timer = setInterval(() => void tick(), intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    onStatus(status: WaConnectionStatus, qr?: string | null, number?: string | null) {
      void pushStatus?.({ status, qr, number }).catch(() => undefined)
    }
  }
}
