import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phone.js'

describe('normalizePhone', () => {
  it('converts a local Egyptian number to E.164', () => {
    expect(normalizePhone('01012345678', '20')).toBe('+201012345678')
  })

  it('keeps an already international number', () => {
    expect(normalizePhone('+20 101 234 5678', '20')).toBe('+201012345678')
  })

  it('converts 00 prefix to +', () => {
    expect(normalizePhone('00201012345678', '20')).toBe('+201012345678')
  })

  it('strips the local trunk 0 when a country code is applied', () => {
    expect(normalizePhone('1012345678', '20')).toBe('+201012345678')
  })

  it('returns null for empty or non-numeric input', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('not-a-phone')).toBeNull()
  })

  it('returns null when too short even with country code', () => {
    expect(normalizePhone('123', '20')).toBeNull()
  })
})
