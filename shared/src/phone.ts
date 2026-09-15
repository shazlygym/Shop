export function normalizePhone(raw: string, defaultCountryCode = '20'): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  const hadPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (!digits) return null

  let normalized: string

  if (hadPlus) {
    normalized = digits
  } else if (digits.startsWith('00')) {
    normalized = digits.slice(2)
  } else if (digits.startsWith(defaultCountryCode) && digits.length > defaultCountryCode.length + 6) {
    normalized = digits
  } else {
    const local = digits.replace(/^0+/, '')
    normalized = `${defaultCountryCode}${local}`
  }

  if (normalized.length < 8 || normalized.length > 15) return null
  return `+${normalized}`
}
