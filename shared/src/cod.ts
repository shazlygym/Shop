const COD_TOKENS = new Set(['cod', 'cashondelivery', 'manual'])
const COD_PHRASES = ['cash on delivery', 'الدفع عند الاستلام', 'عند الاستلام']

export function isCodOrder(gateways: string[]): boolean {
  return gateways.some((gateway) => {
    const normalized = gateway
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (normalized.split(' ').some((token) => COD_TOKENS.has(token))) return true
    return COD_PHRASES.some((phrase) => normalized.includes(phrase))
  })
}
