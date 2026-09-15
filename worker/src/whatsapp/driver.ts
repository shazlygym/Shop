import type { WaConnectionStatus } from '@swc/shared'

export interface OutboundMessage {
  to: string
  body: string
  buttons?: { id: string; label: string }[]
}

export interface InboundMessage {
  from: string
  body: string
  waMessageId: string
  selectedButtonId?: string
}

export interface WhatsAppDriver {
  start(): Promise<void>
  stop(): Promise<void>
  send(message: OutboundMessage): Promise<{ waMessageId: string }>
  onInbound(handler: (message: InboundMessage) => void): void
  onStatus(handler: (status: WaConnectionStatus, qr?: string | null, number?: string | null) => void): void
  isReady(): boolean
  requestReconnect(): Promise<void>
}
