import express from 'express'
import type { Express } from 'express'
import { registerWebhookRoutes } from './routes/webhooks.js'
import { registerOrderRoutes } from './routes/orders.js'
import { registerStatsRoutes } from './routes/stats.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerWhatsAppRoutes } from './routes/whatsapp.js'
import { registerInternalRoutes } from './routes/internal.js'

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

  return app
}
