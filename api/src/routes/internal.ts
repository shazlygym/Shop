import { timingSafeEqual } from 'node:crypto'
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'
import { env } from '../env.js'
import { createShopifyClient } from '../shopify/client.js'

interface ShopifyClient {
  addTags: (id: string, tags: string[]) => Promise<void>
  appendNote: (id: string, line: string) => Promise<void>
}

interface Deps {
  prisma?: PrismaClient
  internalToken?: string
  shopifyClient?: ShopifyClient
}

function formatTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').slice(0, 16)
}

export function registerInternalRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma
  const token = deps.internalToken ?? env.internalToken
  const shopify = deps.shopifyClient ?? createShopifyClient()

  function authorized(header: string | undefined): boolean {
    if (!token || !header) return false
    const provided = Buffer.from(header)
    const expected = Buffer.from(token)
    if (provided.length !== expected.length) return false
    return timingSafeEqual(provided, expected)
  }

  app.post('/api/internal/whatsapp/status', async (req, res) => {
    if (!authorized(req.header('x-internal-token'))) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    try {
      const { status, qr, number } = req.body ?? {}
      await prisma.settings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          messageTemplate: '',
          waStatus: String(status ?? 'disconnected'),
          waQr: qr ?? null,
          waNumber: number ?? null,
          waUpdatedAt: new Date()
        },
        update: {
          waStatus: String(status ?? 'disconnected'),
          waQr: qr ?? null,
          waNumber: number ?? null,
          waUpdatedAt: new Date()
        }
      })

      res.json({ ok: true })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })

  app.post('/api/internal/shopify/apply', async (req, res) => {
    if (!authorized(req.header('x-internal-token'))) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const { orderId, action } = req.body ?? {}
    if (action !== 'confirmed' && action !== 'cancelled') {
      res.status(400).json({ error: 'invalid action' })
      return
    }

    try {
      const order = await prisma.order.findUnique({ where: { id: String(orderId) } })
      if (!order) {
        res.status(404).json({ error: 'order not found' })
        return
      }

      const now = new Date()
      const tag = action === 'confirmed' ? 'confirmed-by-whatsapp' : 'cancelled-by-whatsapp'
      const note = `${tag} at ${formatTimestamp(now)}`

      try {
        await shopify.addTags(order.shopifyOrderId, [tag])
        await shopify.appendNote(order.shopifyOrderId, note)
      } catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : 'shopify failed' })
        return
      }

      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: action,
          ...(action === 'confirmed' ? { confirmedAt: now } : { cancelledAt: now })
        }
      })

      res.json({ ok: true })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })
}
