import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  adaptAlert,
  adaptNode,
  patchNodeReading,
  patchNodeStatus,
  snapshotMetrics,
} from '@/lib/adaptNetwork'
import { api, clearSession, DEFAULT_AUTH, getStoredToken, getStoredUser, storeSession, wsUrl } from '@/lib/api'
import { networkMetrics } from '@/lib/sensors'

function emptyStats() {
  return networkMetrics([], [])
}

export function useLiveNetwork() {
  const [nodes, setNodes] = useState([])
  const [alerts, setAlerts] = useState([])
  const [ticks, setTicks] = useState([])
  const [status, setStatus] = useState('connecting')
  const [error, setError] = useState('')
  const [user, setUser] = useState(() => getStoredUser())
  const [health, setHealth] = useState(null)
  const ref = useRef({ nodes: [], alerts: [] })

  const ensureAuth = useCallback(async () => {
    const existing = getStoredToken()
    if (existing) {
      try {
        const data = await api.me()
        setUser(data.user)
        storeSession(existing, data.user)
        return data.user
      } catch {
        clearSession()
      }
    }
    const data = await api.login(DEFAULT_AUTH.username, DEFAULT_AUTH.password)
    storeSession(data.token, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus((prev) => (prev === 'live' ? prev : 'connecting'))
    try {
      const [listRes, alertRes, healthRes] = await Promise.all([
        api.nodes(),
        api.alerts({ limit: 100 }),
        api.health().catch(() => null),
      ])
      const list = listRes.nodes || []
      const details = await Promise.all(
        list.map((item) =>
          api.node(item.id).catch(() => ({ node: item, risks: item.risks, health: null, latest_readings: [] })),
        ),
      )
      const prevById = Object.fromEntries(ref.current.nodes.map((node) => [node.id, node]))
      const nextNodes = details.map((detail, index) => adaptNode(detail, prevById[list[index]?.id]))
      const nextAlerts = (alertRes.alerts || []).map((row) => adaptAlert(row))
      ref.current = { nodes: nextNodes, alerts: nextAlerts }
      setNodes(nextNodes)
      setAlerts(nextAlerts)
      setHealth(healthRes)
      setTicks((prev) => [...prev, snapshotMetrics(nextNodes, nextAlerts)].slice(-30))
      setError('')
      setStatus('live')
      return { nodes: nextNodes, alerts: nextAlerts }
    } catch (err) {
      setError(err.message || 'Backend unavailable')
      setStatus(ref.current.nodes.length ? 'degraded' : 'offline')
      throw err
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let intervalId
    let socket
    let reconnectTimer

    async function boot() {
      try {
        await ensureAuth().catch(() => null)
        if (cancelled) return
        await refresh()
      } catch {
        // refresh already recorded the error
      }
      if (cancelled) return

      intervalId = window.setInterval(() => {
        refresh({ silent: true }).catch(() => {})
      }, 5000)

      const connectWs = () => {
        try {
          socket = new WebSocket(wsUrl())
        } catch {
          return
        }
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            if (message.event === 'reading' && message.payload) {
              const nextNodes = ref.current.nodes.map((node) => patchNodeReading(node, message.payload))
              ref.current.nodes = nextNodes
              setNodes(nextNodes)
            } else if (message.event === 'alert' && message.payload) {
              const incoming = adaptAlert(message.payload)
              const nextAlerts = [incoming, ...ref.current.alerts.filter((item) => item.id !== incoming.id)].slice(0, 100)
              ref.current.alerts = nextAlerts
              setAlerts(nextAlerts)
            } else if (message.event === 'node_status' && message.payload) {
              const nextNodes = ref.current.nodes.map((node) => patchNodeStatus(node, message.payload))
              ref.current.nodes = nextNodes
              setNodes(nextNodes)
            }
          } catch {
            // ignore malformed frames
          }
        }
        socket.onclose = () => {
          if (cancelled) return
          reconnectTimer = window.setTimeout(connectWs, 4000)
        }
        socket.onerror = () => {
          socket?.close()
        }
      }
      connectWs()
    }

    boot()
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.clearTimeout(reconnectTimer)
      if (socket && socket.readyState === WebSocket.OPEN) socket.close()
    }
  }, [ensureAuth, refresh])

  const stats = useMemo(() => (nodes.length ? networkMetrics(nodes, alerts) : emptyStats()), [nodes, alerts])
  const unackedCount = alerts.filter((item) => item.status === 'active').length

  const mutateAlert = useCallback(async (id, action, label) => {
    try {
      const data = await action(id)
      const next = adaptAlert(data.alert || data)
      setAlerts((prev) => {
        const mapped = prev.map((item) => (item.id === String(id) ? { ...item, ...next } : item))
        ref.current.alerts = mapped
        return mapped
      })
      return next
    } catch (err) {
      toast.error(err.message || `Could not ${label} alert`)
      throw err
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password)
    storeSession(data.token, data.user)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  return {
    nodes,
    alerts,
    ticks,
    stats,
    unackedCount,
    status,
    error,
    user,
    health,
    refresh: () => refresh({ silent: false }).catch(() => {}),
    login,
    logout,
    acknowledgeAlert: (id) => mutateAlert(id, api.acknowledgeAlert, 'acknowledge'),
    escalateAlert: (id) => mutateAlert(id, api.escalateAlert, 'escalate'),
    resolveAlert: (id) => mutateAlert(id, api.resolveAlert, 'resolve'),
  }
}
