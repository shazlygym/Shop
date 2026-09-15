import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'

interface Deps {
  prisma?: PrismaClient
}

export function registerOrderRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma

  app.get('/api/orders', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))

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
  })

  app.get('/api/orders/:id/messages', async (req, res) => {
    const messages = await prisma.message.findMany({
      where: { orderId: req.params.id },
      orderBy: { createdAt: 'asc' }
    })
    res.json({ items: messages })
  })

  app.post('/api/orders/:id/resend', async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } })
    if (!order) {
      res.status(404).json({ error: 'not found' })
      return
    }

    await prisma.order.update({ where: { id: order.id }, data: { status: 'pending' } })
    await prisma.messageJob.create({ data: { orderId: order.id, type: 'confirmation', status: 'pending' } })

    res.json({ ok: true })
  })
}
