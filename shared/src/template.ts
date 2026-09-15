export interface ConfirmationVars {
  orderNumber: string
  customerName: string
  total: string
  currency: string
}

export function renderConfirmation(template: string, vars: ConfirmationVars): string {
  return template
    .replaceAll('{{orderNumber}}', vars.orderNumber)
    .replaceAll('{{customerName}}', vars.customerName)
    .replaceAll('{{total}}', vars.total)
    .replaceAll('{{currency}}', vars.currency)
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
