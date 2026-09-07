import { useEffect, useMemo, useRef, useState } from 'react'
import { alerts as seedAlerts, nodes as seedNodes } from '@/data/mockData'
import { maybeOpenAlerts, networkMetrics, tickNode } from '@/lib/sensors'

function snapshotMetrics(nodes, alerts) {
  const stats = networkMetrics(nodes, alerts)
  const water = nodes.filter((n) => n.type === 'water')
  const forest = nodes.filter((n) => n.type === 'forest')
  const air = nodes.filter((n) => n.type === 'atmosphere')
  return {
    t: Date.now(),
    online: stats.online,
    alerts: stats.activeAlerts,
    avgRisk: stats.avgRisk,
    waterLevel: water.length
      ? Math.round(water.reduce((s, n) => s + n.readings.waterLevelCm, 0) / water.length)
      : 0,
    gas: forest.length ? Math.round(forest.reduce((s, n) => s + n.readings.gasPpm, 0) / forest.length) : 0,
    aqi: air.length ? Math.round(air.reduce((s, n) => s + (n.aqi || 0), 0) / air.length) : 0,
  }
}

export function useLiveNetwork() {
  const [nodes, setNodes] = useState(seedNodes)
  const [alerts, setAlerts] = useState(seedAlerts)
  const [ticks, setTicks] = useState(() => [snapshotMetrics(seedNodes, seedAlerts)])
  const ref = useRef({ nodes: seedNodes, alerts: seedAlerts })

  useEffect(() => {
    const id = setInterval(() => {
      const prevNodes = ref.current.nodes
      const prevAlerts = ref.current.alerts
      const nextNodes = prevNodes.map(tickNode)
      const nextAlerts = maybeOpenAlerts(prevNodes, nextNodes, prevAlerts)
      const tick = snapshotMetrics(nextNodes, nextAlerts)
      ref.current = { nodes: nextNodes, alerts: nextAlerts }
      setNodes(nextNodes)
      setAlerts(nextAlerts)
      setTicks((prev) => [...prev, tick].slice(-30))
    }, 2500)
    return () => clearInterval(id)
  }, [])

  const stats = useMemo(() => networkMetrics(nodes, alerts), [nodes, alerts])
  const unackedCount = alerts.filter((a) => a.status === 'active' || a.status === 'escalated').length

  function patchAlert(id, status) {
    setAlerts((prev) => {
      const next = prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status,
              history: [...(a.history || []), { action: status, at: Date.now(), by: 'control-room' }],
            }
          : a,
      )
      ref.current.alerts = next
      return next
    })
  }

  return {
    nodes,
    alerts,
    ticks,
    stats,
    unackedCount,
    acknowledgeAlert: (id) => patchAlert(id, 'acknowledged'),
    escalateAlert: (id) => patchAlert(id, 'escalated'),
    resolveAlert: (id) => patchAlert(id, 'resolved'),
  }
}
