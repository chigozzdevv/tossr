import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth-provider'
import { useWallet } from '@solana/wallet-adapter-react'
import { useCallback } from 'react'

const NAV_ITEMS = [
  { to: '/app/rounds', label: 'Rounds' },
  { to: '/app/markets', label: 'Markets' },
  { to: '/app/bets', label: 'Bets' },
  { to: '/app/history', label: 'History' },
  { to: '/app/profile', label: 'Profile' },
  { to: '/app/settings', label: 'Settings' },
]

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export function DashboardLayout() {
  const { user, logout } = useAuth()
  const wallet = useWallet()
  const navigate = useNavigate()

  const handleLogout = useCallback(async () => {
    await wallet.disconnect()
    logout()
    navigate('/')
  }, [logout, navigate, wallet])

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <a href="/" className="brand dashboard-sidebar-brand" aria-label="Tossr dashboard">
          <img src="/logo-tossr.svg" alt="" className="brand-mark" aria-hidden />
          <span>tossr</span>
        </a>
        <nav className="dashboard-sidebar-nav" aria-label="Dashboard">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                ['dashboard-nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="dashboard-sidebar-footer">
          {user ? <span className="dashboard-sidebar-identity">{shortAddress(user.walletAddress)}</span> : null}
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="dashboard-topbar">
          <div>
            <span className="dashboard-topbar-title">Dashboard</span>
            <span className="dashboard-topbar-sub">Solana Devnet</span>
          </div>
          <div className="dashboard-topbar-actions">
            {user ? <span className="dashboard-topbar-identity">{shortAddress(user.walletAddress)}</span> : null}
            <Button variant="ghost" onClick={handleLogout} aria-label="Disconnect wallet">
              Disconnect
            </Button>
          </div>
        </header>
        <main className="dashboard-main">
          <div className="container dashboard-main-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
