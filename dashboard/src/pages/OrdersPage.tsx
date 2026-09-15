import { useCallback, useEffect, useState } from 'react'
import { api, type Order } from '../api'
import { StatusBadge } from '../components/StatusBadge'

const FILTERS = [
  { value: '', label: 'الكل' },
  { value: 'pending', label: 'في الانتظار' },
  { value: 'sent', label: 'تم الإرسال' },
  { value: 'confirmed', label: 'مؤكد' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'failed', label: 'فشل' }
]

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [resendError, setResendError] = useState(false)
  const pageSize = 20

  const load = useCallback(async () => {
    try {
      const data = await api.getOrders({ status: status || undefined, q: query || undefined, page })
      setOrders(data.items)
      setTotal(data.total)
    } catch {
      setOrders([])
      setTotal(0)
    }
  }, [status, query, page])

  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <select
          value={status}
          onChange={(event) => { setStatus(event.target.value); setPage(1) }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          {FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>{filter.label}</option>
          ))}
        </select>
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1) }}
          placeholder="ابحث برقم الهاتف أو رقم الأوردر"
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <span className="text-sm text-slate-500">{total} أوردر</span>
      </div>

      {resendError && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
          تعذر إعادة الإرسال
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-right">الأوردر</th>
              <th className="px-4 py-3 text-right">العميل</th>
              <th className="px-4 py-3 text-right">الهاتف</th>
              <th className="px-4 py-3 text-right">الإجمالي</th>
              <th className="px-4 py-3 text-right">الحالة</th>
              <th className="px-4 py-3 text-right">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t">
                <td className="px-4 py-3">{order.orderNumber}</td>
                <td className="px-4 py-3">{order.customerName}</td>
                <td className="px-4 py-3" dir="ltr">{order.phone || '-'}</td>
                <td className="px-4 py-3">{order.total} {order.currency}</td>
                <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => {
                      setResendError(false)
                      void api.resendOrder(order.id).then(load).catch(() => setResendError(true))
                    }}
                    className="rounded-lg border px-3 py-1 text-xs hover:bg-slate-50"
                  >
                    إعادة إرسال
                  </button>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">لا توجد أوردرات</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-40"
        >
          السابق
        </button>
        <span className="text-sm text-slate-500">صفحة {page} من {pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-40"
        >
          التالي
        </button>
      </div>
    </div>
  )
}
