import { describe, expect, it } from 'vitest'
import { computeShopifyHmac, verifyShopifyHmac } from './hmac.js'

const SECRET = 'hush'
const BODY = JSON.stringify({ id: 123, total_price: '100.00' })

describe('shopify hmac', () => {
  it('verifies a correct signature', () => {
    const digest = computeShopifyHmac(BODY, SECRET)
    expect(verifyShopifyHmac(BODY, digest, SECRET)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    expect(verifyShopifyHmac(BODY, 'deadbeef', SECRET)).toBe(false)
  })

  it('rejects a mismatched body', () => {
    const digest = computeShopifyHmac(BODY, SECRET)
    expect(verifyShopifyHmac('{"id":999}', digest, SECRET)).toBe(false)
  })

  it('rejects an empty header', () => {
    expect(verifyShopifyHmac(BODY, '', SECRET)).toBe(false)
  })
})
