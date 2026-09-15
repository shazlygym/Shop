const COD_PATTERNS = ['cash on delivery', 'cashondelivery', 'cod', 'عند الاستلام', 'الدفع عند الاستلام', 'manual']

export function isCodOrder(gateways: string[]): boolean {
  return gateways.some((gateway) => {
    const value = gateway.toLowerCase().trim()
    return COD_PATTERNS.some((pattern) => value.includes(pattern))
  })
}
