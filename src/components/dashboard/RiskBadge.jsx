import { RISK_LEVELS } from '@/lib/sensors'

export function RiskBadge({ risk }) {
  const meta = RISK_LEVELS[risk] || RISK_LEVELS.NORMAL
  return (
    <span className={`badge bg-${meta.variant === 'orange' ? 'warning' : meta.variant}`}>
      {meta.label}
    </span>
  )
}

export function LivePill({ live = true }) {
  return (
    <span className={`badge ${live ? 'bg-success' : 'bg-secondary'} d-inline-flex align-items-center gap-1`}>
      <span className="live-dot" />
      {live ? 'Live' : 'Offline'}
    </span>
  )
}
