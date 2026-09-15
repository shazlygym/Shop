const LABELS: Record<string, string> = {
  pending: 'في الانتظار',
  sent: 'تم الإرسال',
  confirmed: 'مؤكد',
  cancelled: 'ملغي',
  failed: 'فشل'
}

const COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  sent: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-rose-100 text-rose-800',
  failed: 'bg-slate-200 text-slate-700'
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${COLORS[status] ?? ''}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
