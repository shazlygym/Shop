import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'
import { env } from '../env.js'

interface Deps {
  prisma?: PrismaClient
  workerUrl?: string
  fetchImpl?: typeof fetch
}

export function registerWhatsAppRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma
  const workerUrl = deps.workerUrl ?? env.workerUrl
  const doFetch = deps.fetchImpl ?? fetch

  app.get('/api/whatsapp/status', async (_req, res) => {
    try {
      const row = await prisma.settings.findUnique({ where: { id: 1 } })
      res.json({
        status: row?.waStatus ?? 'disconnected',
        qr: row?.waQr ?? null,
        number: row?.waNumber ?? null,
        updatedAt: row?.waUpdatedAt ?? null
      })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })

  app.post('/api/whatsapp/reconnect', async (_req, res) => {
    try {
      const response = await doFetch(`${workerUrl}/internal/reconnect`, { method: 'POST' })
      res.json({ ok: response.ok })
    } catch (error) {
      res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'unreachable' })
    }
  })
}
