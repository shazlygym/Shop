import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'

interface Deps {
  prisma?: PrismaClient
}

function parsePage(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return 1
  return parsed
}

function parsePageSize(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return 20
  return Math.min(100, Math.max(1, parsed))
}

export function registerOrderRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma

  app.get('/api/orders', async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
      const page = parsePage(req.query.page)
      const pageSize = parsePageSize(req.query.pageSize)

      const where = {
        ...(status ? { status } : {}),
        ...(q
          ? { OR: [{ phone: { contains: q } }, { orderNumber: { contains: q } }] }
          : {})
      }

      const [items, total] = await Promise.all([
        prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.order.count({ where })
      ])

      res.json({ items, total, page, pageSize })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })

  app.get('/api/orders/:id/messages', async (req, res) => {
    try {
      const messages = await prisma.message.findMany({
        where: { orderId: req.params.id },
        orderBy: { createdAt: 'asc' }
      })
      res.json({ items: messages })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })

  app.post('/api/orders/:id/resend', async (req, res) => {
    try {
      const order = await prisma.order.findUnique({ where: { id: req.params.id } })
      if (!order) {
        res.status(404).json({ error: 'not found' })
        return
      }

      await prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'pending' } })
        await tx.messageJob.deleteMany({ where: { orderId: order.id, status: 'pending' } })
        await tx.messageJob.create({ data: { orderId: order.id, type: 'confirmation', status: 'pending' } })
      })

      res.json({ ok: true })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })
}
