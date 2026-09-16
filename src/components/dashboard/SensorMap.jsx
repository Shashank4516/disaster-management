import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { RISK_LEVELS, formatRelative, nodeTypeMeta, readingSummary } from '@/lib/sensors'

function FitBounds({ nodes }) {
  const map = useMap()
  const signature = useMemo(() => nodes.map((n) => n.id).join(','), [nodes])

  useEffect(() => {
    const points = nodes.filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng))
    map.invalidateSize()
    if (!points.length) {
      map.setView([22.5, 80], 5)
      return
    }
    const bounds = points.map((n) => [n.lat, n.lng])
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 7 })
  }, [map, nodes, signature])

  useEffect(() => {
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    const timer = window.setTimeout(onResize, 80)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [map])

  return null
}

export function SensorMap({ nodes }) {
  return (
    <div className="sensor-map-frame overflow-hidden">
      <MapContainer
        center={[22.5, 80]}
        zoom={5}
        scrollWheelZoom={false}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        <FitBounds nodes={nodes} />
        {nodes
          .filter((node) => Number.isFinite(node.lat) && Number.isFinite(node.lng))
          .map((node) => {
          const color = RISK_LEVELS[node.risk]?.color || '#64748b'
          return (
            <CircleMarker
              key={node.id}
              center={[node.lat, node.lng]}
              radius={node.risk === 'CRITICAL' ? 11 : 8}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: node.status === 'offline' ? 0.25 : 0.75,
                weight: 2,
                opacity: node.status === 'offline' ? 0.4 : 1,
              }}
            >
              <Popup>
                <div className="p-1">
                  <strong>{node.name}</strong>
                  <div className="fs-11 text-secondary">
                    {node.id} · {nodeTypeMeta(node.type).label} · {node.risk}
                  </div>
                  <div className="fs-11 text-secondary">
                    {node.city}, {node.region}
                  </div>
                  <div className="fs-sm fw-medium">{readingSummary(node)}</div>
                  <div className="fs-11 text-secondary mb-1">Updated {formatRelative(node.lastSeen)}</div>
                  <Link to={`/node/${node.id}`}>Open node detail</Link>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}
