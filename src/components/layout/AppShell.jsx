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
          user={network.user}
          connection={network.status}
        />
        <main className="app-content">
          {network.error ? (
            <div className="alert alert-warning d-flex justify-content-between align-items-center mb-3" role="status">
              <div>
                <strong>Backend unreachable.</strong> {network.error}
                <div className="fs-11 mt-1">Start Environet-BE with <code>npm run backend</code></div>
              </div>
              <button type="button" className="btn btn-sm btn-white" onClick={network.refresh}>
                Retry
              </button>
            </div>
          ) : null}
          {network.status === 'connecting' && network.nodes.length === 0 ? (
            <div className="alert alert-light mb-3" role="status">
              Connecting to Environet API…
            </div>
          ) : null}
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
