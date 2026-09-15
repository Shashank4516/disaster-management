import { useEffect, useState } from 'react'
import { adaptHistory, PRIMARY_SENSOR, RANGE_MAP } from '@/lib/adaptNetwork'
import { api } from '@/lib/api'

export function useNodeHistory(node, rangeKey = 'live') {
  const nodeId = node?.id
  const nodeType = node?.type
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!nodeId || !nodeType) return undefined
    const sensor = PRIMARY_SENSOR[nodeType]
    const range = RANGE_MAP[rangeKey] || '1h'
    if (!sensor) {
      setPoints([])
      return undefined
    }

    let cancelled = false
    setLoading(true)
    api
      .nodeHistory(nodeId, sensor, range)
      .then((data) => {
        if (cancelled) return
        setPoints(adaptHistory(data.points, nodeType))
        setError('')
      })
      .catch((err) => {
        if (cancelled) return
        setPoints([])
        setError(err.message || 'History unavailable')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [nodeId, nodeType, rangeKey])

  const resolved = points.length ? points : node?.history || []
  return { points: resolved, loading, error }
}
