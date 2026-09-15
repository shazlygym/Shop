import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIRMATION_TEMPLATE, renderConfirmation } from './template.js'

describe('renderConfirmation', () => {
  it('replaces all placeholders', () => {
    const out = renderConfirmation('Order {{orderNumber}} for {{customerName}} total {{total}} {{currency}}', {
      orderNumber: '#1001',
      customerName: 'Ahmed',
      total: '250.00',
      currency: 'EGP'
    })
    expect(out).toBe('Order #1001 for Ahmed total 250.00 EGP')
  })

  it('leaves unknown placeholders untouched', () => {
    const out = renderConfirmation('Hi {{customerName}} {{unknown}}', {
      orderNumber: '#1',
      customerName: 'Sara',
      total: '1',
      currency: 'EGP'
    })
    expect(out).toBe('Hi Sara {{unknown}}')
  })

  it('inserts values containing replacement patterns literally', () => {
    const out = renderConfirmation('{{customerName}}', {
      orderNumber: '1',
      customerName: '$&',
      total: '1',
      currency: 'EGP'
    })
    expect(out).toBe('$&')
  })

  it('does not re-substitute a value containing a later placeholder', () => {
    const out = renderConfirmation('{{customerName}} {{total}}', {
      orderNumber: '1',
      customerName: '{{total}}',
      total: '99',
      currency: 'EGP'
    })
    expect(out).toBe('{{total}} 99')
  })

  it('ships a default template containing the confirm instruction', () => {
    expect(DEFAULT_CONFIRMATION_TEMPLATE).toContain('1')
    expect(DEFAULT_CONFIRMATION_TEMPLATE).toContain('{{orderNumber}}')
  })
})
