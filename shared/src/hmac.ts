import { createHmac, timingSafeEqual } from 'node:crypto'

export function computeShopifyHmac(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function computeShopifyHmacBase64(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64')
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8')
  const bBuffer = Buffer.from(b, 'utf8')

  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

export function verifyShopifyHmac(rawBody: string | Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader) return false

  const hex = computeShopifyHmac(rawBody, secret)
  const base64 = computeShopifyHmacBase64(rawBody, secret)

  return safeEqual(hmacHeader, base64) || safeEqual(hmacHeader, hex)
}
