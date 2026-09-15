import express from 'express'
import type { Express } from 'express'

export function createApp(): Express {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  return app
}
