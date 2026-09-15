import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'

interface Deps {
  prisma?: PrismaClient
}

const STATUSES = ['pending', 'sent', 'confirmed', 'cancelled', 'failed'] as const

export function registerStatsRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma

  app.get('/api/stats', async (_req, res) => {
    try {
      const grouped = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } })

      const counts: Record<string, number> = {}
      for (const status of STATUSES) counts[status] = 0
      for (const row of grouped) counts[row.status] = row._count._all
      const total = Object.values(counts).reduce((sum, value) => sum + value, 0)

      const decided = counts.confirmed + counts.cancelled
      const confirmationRate = decided === 0 ? 0 : Math.round((counts.confirmed / decided) * 100) / 100

      res.json({ total, ...counts, confirmationRate })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })
}
