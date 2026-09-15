import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { Express } from 'express'
import { registerWebhookRoutes } from './routes/webhooks.js'
import { registerOrderRoutes } from './routes/orders.js'
import { registerStatsRoutes } from './routes/stats.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerWhatsAppRoutes } from './routes/whatsapp.js'
import { registerInternalRoutes } from './routes/internal.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dashboardDist = process.env.DASHBOARD_DIST ?? path.resolve(here, '../../dashboard/dist')

export function createApp(): Express {
  const app = express()
  const jsonParser = express.json()

  app.use((req, res, next) => {
    if (req.path.toLowerCase().startsWith('/webhooks')) return next()
    jsonParser(req, res, next)
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  registerWebhookRoutes(app)
  registerOrderRoutes(app)
  registerStatsRoutes(app)
  registerSettingsRoutes(app)
  registerWhatsAppRoutes(app)
  registerInternalRoutes(app)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'))
    })
  }

  return app
}
