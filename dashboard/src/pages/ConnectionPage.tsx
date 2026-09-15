import { useCallback, useEffect, useState } from 'react'
import { api, type WaStatus } from '../api'

const LABELS: Record<string, string> = {
  connecting: 'جاري الاتصال...',
  qr: 'امسح كود QR من واتساب',
  ready: 'متصل',
  disconnected: 'غير متصل'
}

export function ConnectionPage() {
  const [status, setStatus] = useState<WaStatus | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getWhatsAppStatus())
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 3000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!status?.qr) {
      setQrImage(null)
      return
    }
    void import('qrcode')
      .then(({ toDataURL }) =>
        toDataURL(status.qr!, { margin: 1, width: 260 }).then(setQrImage)
      )
      .catch(() => setQrImage(null))
  }, [status?.qr])

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-xl font-bold">حالة واتساب</h2>
      <p className="mb-2 text-sm text-slate-600">
        {LABELS[status?.status ?? 'disconnected']}
      </p>

      {status?.number && <p className="mb-2 text-sm">الرقم المتصل: {status.number}</p>}

      {qrImage && (
        <div className="my-4 flex flex-col items-center gap-2">
          <img src={qrImage} alt="WhatsApp QR" className="rounded-xl border" />
          <p className="text-sm text-slate-500">
            من واتساب: الأجهزة المرتبطة، ثم ربط جهاز.
          </p>
        </div>
      )}

      <button
        onClick={() => void api.reconnectWhatsApp().then(refresh)}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        إعادة الاتصال
      </button>
    </div>
  )
}
