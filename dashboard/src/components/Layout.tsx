import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/', label: 'الأوردرات' },
  { to: '/stats', label: 'الإحصائيات' },
  { to: '/connection', label: 'الاتصال' },
  { to: '/settings', label: 'الإعدادات' }
]

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-bold">تأكيد أوردرات واتساب</h1>
          <nav className="flex gap-2">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
