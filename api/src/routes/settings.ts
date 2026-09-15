import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { DEFAULT_CONFIRMATION_TEMPLATE } from '@swc/shared'
import { prisma as defaultPrisma } from '../db.js'

interface Deps {
  prisma?: PrismaClient
}

const MASK = '********'

function present(row: {
  shopDomain: string
  adminAccessToken: string
  webhookSecret: string
  messageTemplate: string
  interactiveButtons: boolean
}) {
  return {
    shopDomain: row.shopDomain,
    adminAccessToken: row.adminAccessToken ? MASK : '',
    webhookSecret: row.webhookSecret ? MASK : '',
    messageTemplate: row.messageTemplate,
    interactiveButtons: row.interactiveButtons
  }
}

export function registerSettingsRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma

  async function ensureRow() {
    const existing = await prisma.settings.findUnique({ where: { id: 1 } })
    if (existing) return existing
    return prisma.settings.create({
      data: { id: 1, messageTemplate: DEFAULT_CONFIRMATION_TEMPLATE }
    })
  }

  app.get('/api/settings', async (_req, res) => {
    try {
      const row = await ensureRow()
      res.json(present(row))
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })

  app.put('/api/settings', async (req, res) => {
    try {
      const row = await ensureRow()
      const body = req.body ?? {}

      const data: Record<string, unknown> = {}
      if (typeof body.shopDomain === 'string') data.shopDomain = body.shopDomain
      if (typeof body.messageTemplate === 'string' && body.messageTemplate.trim()) {
        data.messageTemplate = body.messageTemplate
      }
      if (typeof body.interactiveButtons === 'boolean') data.interactiveButtons = body.interactiveButtons
      if (typeof body.adminAccessToken === 'string' && body.adminAccessToken && body.adminAccessToken !== MASK) {
        data.adminAccessToken = body.adminAccessToken
      }
      if (typeof body.webhookSecret === 'string' && body.webhookSecret && body.webhookSecret !== MASK) {
        data.webhookSecret = body.webhookSecret
      }

      const updated = await prisma.settings.update({ where: { id: row.id }, data })
      res.json(present(updated))
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })
}
