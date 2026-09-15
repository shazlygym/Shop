export interface Order {
  id: string
  shopifyOrderId: string
  orderNumber: string
  customerName: string
  phone: string
  total: string
  currency: string
  status: 'pending' | 'sent' | 'confirmed' | 'cancelled' | 'failed'
  createdAt: string
  confirmedAt: string | null
  cancelledAt: string | null
}

export interface Stats {
  total: number
  pending: number
  sent: number
  confirmed: number
  cancelled: number
  failed: number
  confirmationRate: number
}

export interface Settings {
  shopDomain: string
  adminAccessToken: string
  webhookSecret: string
  messageTemplate: string
  interactiveButtons: boolean
}

export interface WaStatus {
  status: 'connecting' | 'qr' | 'ready' | 'disconnected'
  qr: string | null
  number: string | null
  updatedAt: string | null
}

async function json<T>(pending: Promise<Response>): Promise<T> {
  const res = await pending
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  getOrders(params: { status?: string; q?: string; page?: number } = {}) {
    const search = new URLSearchParams()
    if (params.status) search.set('status', params.status)
    if (params.q) search.set('q', params.q)
    if (params.page) search.set('page', String(params.page))
    return json<{ items: Order[]; total: number; page: number; pageSize: number }>(
      fetch(`/api/orders?${search.toString()}`)
    )
  },
  resendOrder(id: string) {
    return json<{ ok: boolean }>(fetch(`/api/orders/${id}/resend`, { method: 'POST' }))
  },
  getStats() {
    return json<Stats>(fetch('/api/stats'))
  },
  getSettings() {
    return json<Settings>(fetch('/api/settings'))
  },
  saveSettings(payload: Partial<Settings>) {
    return json<Settings>(
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    )
  },
  getWhatsAppStatus() {
    return json<WaStatus>(fetch('/api/whatsapp/status'))
  },
  reconnectWhatsApp() {
    return json<{ ok: boolean }>(fetch('/api/whatsapp/reconnect', { method: 'POST' }))
  }
}
