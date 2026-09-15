import { createHmac, timingSafeEqual } from 'node:crypto'

export function computeShopifyHmac(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function verifyShopifyHmac(rawBody: string | Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader) return false

  const expected = computeShopifyHmac(rawBody, secret)
  const received = Buffer.from(hmacHeader, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')

  if (received.length !== expectedBuffer.length) return false
  return timingSafeEqual(received, expectedBuffer)
}
