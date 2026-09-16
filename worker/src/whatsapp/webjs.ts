import { mkdirSync } from 'node:fs'
import WAWebJS from 'whatsapp-web.js'
import { normalizePhone } from '@swc/shared'
import type { WaConnectionStatus } from '@swc/shared'
import { env } from '../env.js'
import type { InboundMessage, OutboundMessage, WhatsAppDriver } from './driver.js'

export function createWebjsDriver(): WhatsAppDriver {
  mkdirSync(env.sessionPath, { recursive: true })

  let ready = false
  let reconnecting = false
  let inboundHandler: ((message: InboundMessage) => void) | null = null
  let statusHandler: ((status: WaConnectionStatus, qr?: string | null, number?: string | null) => void) | null = null

  const client = new WAWebJS.Client({
    authStrategy: new WAWebJS.LocalAuth({ dataPath: env.sessionPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  })

  client.on('qr', (qr) => statusHandler?.('qr', qr, null))
  client.on('loading_screen', () => statusHandler?.('connecting', null, null))
  client.on('authenticated', () => statusHandler?.('connecting', null, null))
  client.on('auth_failure', () => statusHandler?.('disconnected', null, null))
  client.on('disconnected', () => {
    ready = false
    statusHandler?.('disconnected', null, null)
  })
  client.on('ready', () => {
    ready = true
    const number = client.info?.wid?.user ?? null
    statusHandler?.('ready', null, number)
  })

  client.on('message', async (message) => {
    if (!inboundHandler) return
    const rawFrom = message.from.split('@')[0]
    const phone = normalizePhone(rawFrom, env.defaultCountryCode)
    if (!phone) return

    let selectedButtonId: string | undefined
    const selected = (message as unknown as { selectedButtonId?: string }).selectedButtonId
    if (selected) selectedButtonId = selected

    const resolved = await (message as unknown as { getContact?: () => Promise<{ number: string }> })
      .getContact?.()
      .catch(() => undefined)
    const resolvedPhone = resolved?.number ? normalizePhone(resolved.number, env.defaultCountryCode) : null

    inboundHandler({
      from: resolvedPhone ?? phone,
      body: message.body ?? '',
      waMessageId: message.id?._serialized ?? '',
      selectedButtonId
    })
  })

  async function sendText(to: string, body: string): Promise<{ waMessageId: string }> {
    const chatId = `${to.replace('+', '')}@c.us`
    const sent = await client.sendMessage(chatId, body)
    return { waMessageId: sent.id?._serialized ?? '' }
  }

  async function trySendButtons(to: string, message: OutboundMessage): Promise<{ waMessageId: string } | null> {
    try {
      const chatId = `${to.replace('+', '')}@c.us`
      const buttons = (message.buttons ?? []).map((b) => ({ body: b.label, id: b.id }))
      const interactive = new WAWebJS.Buttons(message.body, buttons, '', '')
      const sent = await client.sendMessage(chatId, interactive as never)
      return { waMessageId: sent.id?._serialized ?? '' }
    } catch {
      return null
    }
  }

  function withFallbackHint(body: string): string {
    return `${body}\n\nReply 1 to confirm or 2 to cancel.`
  }

  return {
    async start() {
      statusHandler?.('connecting', null, null)
      await client.initialize()
    },
    async stop() {
      ready = false
      await client.destroy()
    },
    async send(message: OutboundMessage) {
      if (message.buttons?.length) {
        const sent = await trySendButtons(message.to, message)
        if (sent) return sent
        return sendText(message.to, withFallbackHint(message.body))
      }
      return sendText(message.to, message.body)
    },
    onInbound(handler) {
      inboundHandler = handler
    },
    onStatus(handler) {
      statusHandler = handler
    },
    isReady() {
      return ready
    },
    async requestReconnect() {
      if (reconnecting) return
      reconnecting = true
      ready = false
      statusHandler?.('connecting', null, null)
      try {
        await client.destroy()
        await client.initialize()
      } catch {
        ready = false
        statusHandler?.('disconnected', null, null)
      } finally {
        reconnecting = false
      }
    }
  }
}
