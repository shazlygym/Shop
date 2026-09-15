import { describe, expect, it } from 'vitest'
import { parseReply } from './reply.js'

describe('parseReply', () => {
  it('parses numeric 1 as confirm', () => {
    expect(parseReply('1')).toBe('confirm')
  })

  it('parses numeric 2 as cancel', () => {
    expect(parseReply('2')).toBe('cancel')
  })

  it('parses Arabic words', () => {
    expect(parseReply('تأكيد')).toBe('confirm')
    expect(parseReply('الغاء')).toBe('cancel')
  })

  it('parses English words case-insensitively', () => {
    expect(parseReply('CONFIRM')).toBe('confirm')
    expect(parseReply('cancel ')).toBe('cancel')
  })

  it('parses button ids', () => {
    expect(parseReply('confirm_order')).toBe('confirm')
    expect(parseReply('cancel_order')).toBe('cancel')
  })

  it('returns unknown for anything else', () => {
    expect(parseReply('where is my order')).toBe('unknown')
    expect(parseReply('')).toBe('unknown')
  })
})
