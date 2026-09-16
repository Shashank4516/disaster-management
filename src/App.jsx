import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AlertsPage } from '@/pages/AlertsPage'
import { HazardsPage } from '@/pages/HazardsPage'
import { NodeDetailPage } from '@/pages/NodeDetailPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { RawSensorsPage } from '@/pages/RawSensorsPage'
import { SensorsPage } from '@/pages/SensorsPage'
import { SettingsPage } from '@/pages/SettingsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="sensors" element={<SensorsPage />} />
          <Route path="raw-sensors" element={<RawSensorsPage />} />
          <Route path="node/:nodeId" element={<NodeDetailPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="hazards" element={<HazardsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
