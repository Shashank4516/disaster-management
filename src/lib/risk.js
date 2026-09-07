export function riskVariant(risk) {
  if (risk === 'CRITICAL') return 'danger'
  if (risk === 'WARNING') return 'warning'
  if (risk === 'WATCH') return 'info'
  return 'success'
}

export function statusVariant(status) {
  if (status === 'online') return 'success'
  if (status === 'degraded') return 'warning'
  return 'secondary'
}

export function alertStatusVariant(status) {
  if (status === 'active') return 'danger'
  if (status === 'escalated') return 'warning'
  if (status === 'acknowledged') return 'info'
  return 'success'
}
