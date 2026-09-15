import express from 'express'
import type { Express } from 'express'
import { registerWebhookRoutes } from './routes/webhooks.js'

export function createApp(): Express {
  const app = express()

  app.use((req, res, next) => {
    if (req.path.startsWith('/webhooks')) return next()
    express.json()(req, res, next)
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  registerWebhookRoutes(app)

  return app
}
