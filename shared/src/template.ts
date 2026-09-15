export interface ConfirmationVars {
  orderNumber: string
  customerName: string
  total: string
  currency: string
}

export function renderConfirmation(template: string, vars: ConfirmationVars): string {
  return template.replace(
    /\{\{(orderNumber|customerName|total|currency)\}\}/g,
    (_match, key: string) => vars[key as keyof ConfirmationVars]
  )
}

export const DEFAULT_CONFIRMATION_TEMPLATE = [
  'مرحباً {{customerName}}',
  '',
  'طلبك رقم {{orderNumber}} بمبلغ {{total}} {{currency}}',
  'من فضلك أكد الطلب للاستمرار في التجهيز:',
  '',
  'ابعت 1 لتأكيد الطلب',
  'ابعت 2 لإلغاء الطلب'
].join('\n')
