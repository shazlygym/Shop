import { describe, expect, it } from 'vitest'
import { isCodOrder } from './cod.js'

describe('isCodOrder', () => {
  it('accepts cash on delivery variants', () => {
    expect(isCodOrder(['Cash on Delivery (COD)'])).toBe(true)
    expect(isCodOrder(['cashondelivery'])).toBe(true)
    expect(isCodOrder(['cod'])).toBe(true)
    expect(isCodOrder(['الدفع عند الاستلام'])).toBe(true)
  })

  it('accepts manual payments', () => {
    expect(isCodOrder(['manual'])).toBe(true)
  })

  it('rejects online payment gateways', () => {
    expect(isCodOrder(['shopify_payments'])).toBe(false)
    expect(isCodOrder(['paypal'])).toBe(false)
  })

  it('rejects gateway names that merely contain cod as a substring', () => {
    expect(isCodOrder(['barcode'])).toBe(false)
    expect(isCodOrder(['promo_code'])).toBe(false)
  })

  it('returns false for an empty list', () => {
    expect(isCodOrder([])).toBe(false)
  })
})
