import type { ReplyIntent } from './types.js'

const CONFIRM = new Set(['1', 'confirm', 'confirmed', 'yes', 'y', 'تأكيد', 'تاكيد', 'نعم', 'confirm_order'])
const CANCEL = new Set(['2', 'cancel', 'cancelled', 'canceled', 'no', 'n', 'إلغاء', 'الغاء', 'لا', 'cancel_order'])

function normalize(body: string): string {
  return body
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ')
}

export function parseReply(body: string): ReplyIntent {
  const value = normalize(body)
  if (!value) return 'unknown'
  if (CONFIRM.has(value)) return 'confirm'
  if (CANCEL.has(value)) return 'cancel'
  return 'unknown'
}
