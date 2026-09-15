import http from 'node:http'
import { prisma } from './db.js'
import { env } from './env.js'
import { createNotifier } from './api-client.js'
import { createBot } from './bot.js'
import { createWebjsDriver } from './whatsapp/webjs.js'

async function pushStatus(payload: { status: string; qr?: string | null; number?: string | null }): Promise<void> {
  await fetch(`${env.apiUrl}/api/internal/whatsapp/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-token': env.internalToken },
    body: JSON.stringify(payload)
  })
}

async function main(): Promise<void> {
  const driver = createWebjsDriver()
  const notify = createNotifier()
  const bot = createBot({ prisma, driver, notify, pushStatus: pushStatus as never })

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ready: driver.isReady() }))
      return
    }
    if (req.method === 'POST' && req.url === '/internal/reconnect') {
      void driver.requestReconnect().catch(() => undefined)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404)
    res.end()
  })

  server.listen(env.workerPort, () => {
    console.log(`[worker] health on http://localhost:${env.workerPort}`)
  })

  bot.start()
  await driver.start()
}

main().catch((error) => {
  console.error('[worker] fatal', error)
  process.exit(1)
})
