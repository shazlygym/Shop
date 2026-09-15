import { useEffect, useState } from 'react'
import { api, type Settings } from '../api'

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void api.getSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  if (!settings) {
    return <div className="rounded-2xl bg-white p-6 text-slate-400 shadow-sm">جاري التحميل...</div>
  }

  const current = settings

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((state) => (state ? { ...state, [key]: value } : state))
    setSaved(false)
  }

  async function save() {
    const updated = await api.saveSettings(current)
    setSettings(updated)
    setSaved(true)
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">الإعدادات</h2>

      <label className="block">
        <span className="text-sm text-slate-600">دومين متجر شوبيفاي</span>
        <input
          value={settings.shopDomain}
          onChange={(event) => update('shopDomain', event.target.value)}
          placeholder="your-store.myshopify.com"
          dir="ltr"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-600">Admin API access token</span>
        <input
          value={settings.adminAccessToken}
          onChange={(event) => update('adminAccessToken', event.target.value)}
          dir="ltr"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-600">Webhook secret</span>
        <input
          value={settings.webhookSecret}
          onChange={(event) => update('webhookSecret', event.target.value)}
          dir="ltr"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-600">قالب الرسالة</span>
        <textarea
          value={settings.messageTemplate}
          onChange={(event) => update('messageTemplate', event.target.value)}
          rows={8}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
        <span className="text-xs text-slate-400">
          المتغيرات: {'{{orderNumber}}'} {'{{customerName}}'} {'{{total}}'} {'{{currency}}'}
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.interactiveButtons}
          onChange={(event) => update('interactiveButtons', event.target.checked)}
        />
        <span className="text-sm">إرسال أزرار تفاعلية (مع الرجوع تلقائياً للرد الرقمي)</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          حفظ
        </button>
        {saved && <span className="text-sm text-emerald-600">تم الحفظ</span>}
      </div>
    </div>
  )
}
