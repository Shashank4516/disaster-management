import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppFooter } from '@/components/layout/AppFooter'
import { AppHeader } from '@/components/layout/AppHeader'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { useLiveNetwork } from '@/hooks/useLiveNetwork'

export function AppShell() {
  const network = useLiveNetwork()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className={`app-shell${sidebarOpen ? ' sidebar-open' : ''}`}>
      <AppSidebar alertCount={network.unackedCount} onNavigate={() => setSidebarOpen(false)} />
      <div className="app-workspace">
        <AppHeader
          onMenu={() => setSidebarOpen((open) => !open)}
          alerts={network.alerts}
          unackedCount={network.unackedCount}
        />
        <main className="app-content">
          <Outlet context={network} />
          <AppFooter />
        </main>
      </div>
      <button
        className="app-backdrop"
        type="button"
        aria-label="Close navigation"
        onClick={() => setSidebarOpen(false)}
      />
    </div>
  )
}
