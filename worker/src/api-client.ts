import { env } from './env.js'

interface NotifierConfig {
  apiUrl?: string
  internalToken?: string
  fetchImpl?: typeof fetch
}

export function createNotifier(config: NotifierConfig = {}) {
  const apiUrl = config.apiUrl ?? env.apiUrl
  const token = config.internalToken ?? env.internalToken
  const doFetch = config.fetchImpl ?? fetch

  return async function notify(orderId: string, action: 'confirmed' | 'cancelled'): Promise<void> {
    const res = await doFetch(`${apiUrl}/api/internal/shopify/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ orderId, action })
    })
    if (!res.ok) {
      throw new Error(`apply failed with HTTP ${res.status}`)
    }
  }
}
