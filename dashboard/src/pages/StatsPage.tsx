import { useEffect, useState } from 'react'
import { api, type Stats } from '../api'

type StatKey = 'total' | 'sent' | 'confirmed' | 'cancelled' | 'pending' | 'failed'

const CARDS: { key: StatKey; label: string }[] = [
  { key: 'total', label: 'إجمالي الأوردرات' },
  { key: 'sent', label: 'تم الإرسال' },
  { key: 'confirmed', label: 'مؤكد' },
  { key: 'cancelled', label: 'ملغي' },
  { key: 'pending', label: 'في الانتظار' },
  { key: 'failed', label: 'فشل' }
]

export function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    void api.getStats().then(setStats).catch(() => setStats(null))
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {CARDS.map((card) => (
          <div key={card.key} className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold">{stats ? stats[card.key] : '-'}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">نسبة التأكيد (مؤكد مقابل ملغي)</p>
        <p className="mt-2 text-3xl font-bold">
          {stats ? `${Math.round(stats.confirmationRate * 100)}%` : '-'}
        </p>
      </div>
    </div>
  )
}
