import { NODE_TYPES, aqiFromPm, classifyNode, snapshotValues } from '@/lib/sensors'

export const RISK_FROM_LEVEL = {
  0: 'NORMAL',
  1: 'WATCH',
  2: 'WARNING',
  3: 'CRITICAL',
}

export const RANGE_MAP = {
  live: '1h',
  day: '24h',
  week: '7d',
}

export const PRIMARY_SENSOR = {
  water: 'ultrasonic_water_level',
  forest: 'mq135_gas',
  atmosphere: 'dht22_temp',
}

const PLACES = [
  { lat: 26.1445, lng: 91.7362, city: 'Guwahati', region: 'Assam' },
  { lat: 30.3165, lng: 78.0322, city: 'Dehradun', region: 'Uttarakhand' },
  { lat: 28.6469, lng: 77.316, city: 'Delhi', region: 'Delhi NCR' },
  { lat: 19.076, lng: 72.8777, city: 'Mumbai', region: 'Maharashtra' },
]

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : fallback
}

function trendLabel(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Stable'
  if (n < -0.15) return 'Falling (3–6h)'
  if (n > 0.15) return 'Rising'
  return 'Stable'
}

export function mapHazard(hazard) {
  if (hazard === 'air_quality' || hazard === 'pollution' || hazard === 'atmosphere') return 'pollution'
  if (hazard === 'fire' || hazard === 'forest') return 'fire'
  if (hazard === 'flood' || hazard === 'water') return 'flood'
  return hazard || 'flood'
}

export function mapRisk(value) {
  if (typeof value === 'string' && RISK_FROM_LEVEL[value] == null) {
    const upper = value.toUpperCase()
    if (RISK_FROM_LEVEL[upper] || ['NORMAL', 'WATCH', 'WARNING', 'CRITICAL'].includes(upper)) return upper
  }
  const level = Number(value)
  return RISK_FROM_LEVEL[level] || 'NORMAL'
}

export function placeFor(lat, lng, name) {
  const hit = PLACES.find((p) => Math.hypot(p.lat - lat, p.lng - lng) < 0.45)
  if (hit) return hit
  return {
    city: name || 'Field site',
    region: Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E` : 'Unknown',
  }
}

function readingsFromLatest(latest = []) {
  const by = Object.fromEntries((latest || []).map((row) => [row.sensor_type, row.values || {}]))
  const flame = by.flame || {}
  const gas = by.mq135_gas || {}
  const soil = by.soil_moisture || {}
  const water = by.ultrasonic_water_level || {}
  const rain = by.rain_gauge || {}
  const turb = by.turbidity || {}
  const press = by.bmp280_pressure || {}
  const temp = by.dht22_temp || {}
  const hum = by.dht22_humidity || {}
  const part = by.particulate || {}
  return {
    waterLevelCm: num(water.level_cm),
    rainfallMmHr: num(rain.rainfall_rate_mmph),
    rateOfRiseCmHr: num(water.rate_of_rise),
    turbidityNtu: num(turb.turbidity_ntu),
    turbidityDelta: num(turb.turbidity_deviation),
    temperatureC: num(temp.celsius),
    humidityPct: num(hum.relative_humidity_pct),
    pressureHpa: num(press.pressure_hpa, 1013),
    pressureTrend: trendLabel(press.pressure_trend),
    flameDetected: Boolean(flame.detected),
    flameSustained: Boolean(flame.detected),
    gasPpm: num(gas.gas_ppm),
    gasDelta: num(gas.gas_deviation),
    soilMoisturePct: num(soil.moisture_pct, 40),
    drynessTrend: num(soil.moisture_pct, 40) < 18 ? 'Multi-day drying' : 'Moist',
    pm25: num(part.pm25),
    pm10: num(part.pm10),
    coPpm: num(part.co_ppm),
    no2Ppb: num(part.no2_ppb),
  }
}

export const SENSOR_PATCH = {
  flame: (values) => ({ flameDetected: Boolean(values.detected), flameSustained: Boolean(values.detected) }),
  mq135_gas: (values) => ({ gasPpm: num(values.gas_ppm), gasDelta: num(values.gas_deviation) }),
  soil_moisture: (values) => ({
    soilMoisturePct: num(values.moisture_pct),
    drynessTrend: num(values.moisture_pct) < 18 ? 'Multi-day drying' : 'Moist',
  }),
  ultrasonic_water_level: (values) => ({
    waterLevelCm: num(values.level_cm),
    rateOfRiseCmHr: num(values.rate_of_rise),
  }),
  rain_gauge: (values) => ({ rainfallMmHr: num(values.rainfall_rate_mmph) }),
  turbidity: (values) => ({
    turbidityNtu: num(values.turbidity_ntu),
    turbidityDelta: num(values.turbidity_deviation),
  }),
  bmp280_pressure: (values) => ({
    pressureHpa: num(values.pressure_hpa, 1013),
    pressureTrend: trendLabel(values.pressure_trend),
  }),
  dht22_temp: (values) => ({ temperatureC: num(values.celsius) }),
  dht22_humidity: (values) => ({ humidityPct: num(values.relative_humidity_pct) }),
}

function pickPrimaryRisk(type, risks = []) {
  const wanted = NODE_TYPES[type]?.hazard
  const mapped = (risks || []).map((row) => ({
    hazard: mapHazard(row.hazard || row.hazard_type),
    level: Number(row.level ?? row.risk_level ?? 0),
    confidence: Number(row.confidence ?? 0.9),
  }))
  return (
    mapped.find((row) => row.hazard === wanted) ||
    [...mapped].sort((a, b) => b.level - a.level)[0] || {
      hazard: wanted || 'flood',
      level: 0,
      confidence: 0.9,
    }
  )
}

function nodeStatus(health, listNode, battery) {
  const online = health?.online ?? listNode?.latest_online
  if (online === false) return 'offline'
  if (battery < 20) return 'degraded'
  if (listNode?.status && listNode.status !== 'active') return String(listNode.status)
  return 'online'
}

export function adaptNode(payload, previous) {
  const isDetail = Boolean(payload?.node)
  const raw = isDetail ? payload.node : payload
  const health = isDetail ? payload.health : null
  const risks = isDetail ? payload.risks : payload.risks
  const latest = isDetail ? payload.latest_readings : null
  const type = raw.node_type || raw.type || previous?.type || 'water'
  const lat = Number(raw.latitude ?? raw.lat ?? previous?.lat)
  const lng = Number(raw.longitude ?? raw.lng ?? previous?.lng)
  const place = placeFor(lat, lng, raw.name)
  const readings = latest
    ? readingsFromLatest(latest)
    : previous?.readings || readingsFromLatest([])
  const battery = num(health?.battery_pct ?? previous?.battery, 80)
  const signalDbm = num(health?.signal_dbm ?? previous?.signalDbm, -70)
  const lastSeen = health?.time
    ? new Date(health.time).getTime()
    : raw.latest_health_at
      ? new Date(raw.latest_health_at).getTime()
      : previous?.lastSeen || Date.now()
  const status = nodeStatus(health, raw, battery)
  const classified = classifyNode({ type, readings, status, signalDbm })
  const primary = pickPrimaryRisk(type, risks)
  const risk = mapRisk(primary.level)
  const historyBase = previous?.history || []
  const sample = { t: Date.now(), ...snapshotValues({ type, readings, aqi: classified.aqi }) }
  const history = historyBase.length ? [...historyBase, sample].slice(-48) : [sample]

  return {
    id: raw.id,
    name: raw.name || raw.id,
    type,
    hazard: NODE_TYPES[type]?.hazard || primary.hazard,
    region: place.region,
    city: place.city,
    lat: Number.isFinite(lat) ? lat : 22.5,
    lng: Number.isFinite(lng) ? lng : 80,
    deployedAt: raw.deployed_at ? String(raw.deployed_at).slice(0, 10) : previous?.deployedAt || '—',
    status,
    battery,
    signalDbm,
    lastSeen,
    readings,
    risk,
    riskScore: classified.riskScore,
    confidence: Math.max(0.45, Math.min(0.99, Number(primary.confidence) || classified.confidence)),
    trigger: classified.trigger,
    aqi: classified.aqi,
    history,
  }
}

export function patchNodeReading(node, payload) {
  const apply = SENSOR_PATCH[payload.sensor]
  if (!apply || payload.node_id !== node.id) return node
  const readings = { ...node.readings, ...apply(payload.values || {}) }
  const next = { ...node, readings, lastSeen: payload.time ? new Date(payload.time).getTime() : Date.now() }
  const classified = classifyNode(next)
  const sample = { t: Date.now(), ...snapshotValues({ ...next, ...classified }) }
  return {
    ...next,
    ...classified,
    risk: node.risk,
    confidence: node.confidence,
    history: [...(node.history || []), sample].slice(-48),
  }
}

export function patchNodeStatus(node, payload) {
  if (payload.node_id !== node.id) return node
  const battery = num(payload.battery_pct, node.battery)
  return {
    ...node,
    battery,
    signalDbm: num(payload.signal_dbm, node.signalDbm),
    status: payload.online === false ? 'offline' : battery < 20 ? 'degraded' : 'online',
    lastSeen: payload.time ? new Date(payload.time).getTime() : Date.now(),
  }
}

export function adaptAlert(row, events = []) {
  const hazard = mapHazard(row.hazard_type || row.hazard)
  const severity = mapRisk(row.severity)
  const type = Object.values(NODE_TYPES).find((item) => item.hazard === hazard)
  const history = (events.length ? events : [{ event_type: 'opened', created_at: row.triggered_at }]).map((event) => ({
    action: event.event_type || event.action || 'opened',
    at: new Date(event.created_at || event.at || row.triggered_at).getTime(),
    by: event.actor || event.by || 'edge-engine',
  }))

  return {
    id: String(row.id),
    nodeId: row.node_id,
    area: row.node_name || row.node_id,
    hazard,
    severity,
    title: `${type?.hazardLabel || hazard} ${severity.toLowerCase()} — ${row.node_name || row.node_id}`,
    message: row.message || '',
    action:
      severity === 'CRITICAL'
        ? 'Dispatch field team and issue public advisory.'
        : 'Increase monitoring cadence and notify regional desk.',
    ts: row.triggered_at ? new Date(row.triggered_at).getTime() : Date.now(),
    status: row.status || 'active',
    trigger: row.message || '',
    history,
  }
}

export function adaptHistory(points = [], type = 'water') {
  return (points || []).map((point) => {
    const t = new Date(point.bucket || point.time).getTime()
    if (type === 'water') {
      return {
        t,
        waterLevelCm: num(point.level_cm ?? point.avg_level_cm),
        rainfallMmHr: num(point.rainfall_rate_mmph ?? point.max_rainfall_rate_mmph),
        turbidityNtu: num(point.turbidity_ntu ?? point.avg_turbidity_ntu),
        rateOfRiseCmHr: num(point.rate_of_rise ?? point.avg_rate_of_rise),
      }
    }
    if (type === 'forest') {
      return {
        t,
        gasPpm: num(point.gas_ppm ?? point.avg_gas_ppm),
        soilMoisturePct: num(point.moisture_pct ?? point.avg_moisture_pct),
        flame: point.any_detection || point.detected ? 1 : 0,
      }
    }
    const pm25 = num(point.pm25 ?? point.avg_pm25)
    const pm10 = num(point.pm10 ?? point.avg_pm10)
    return { t, pm25, pm10, aqi: aqiFromPm(pm25, pm10) }
  })
}

export function snapshotMetrics(nodes, alerts) {
  const online = nodes.filter((n) => n.status === 'online').length
  const water = nodes.filter((n) => n.type === 'water')
  const forest = nodes.filter((n) => n.type === 'forest')
  const air = nodes.filter((n) => n.type === 'atmosphere')
  const avgRisk = Math.round(nodes.reduce((sum, n) => sum + (n.riskScore || 0), 0) / (nodes.length || 1))
  return {
    t: Date.now(),
    online,
    alerts: alerts.filter((a) => a.status !== 'resolved').length,
    avgRisk,
    waterLevel: water.length
      ? Math.round(water.reduce((sum, n) => sum + (n.readings?.waterLevelCm || 0), 0) / water.length)
      : 0,
    gas: forest.length
      ? Math.round(forest.reduce((sum, n) => sum + (n.readings?.gasPpm || 0), 0) / forest.length)
      : 0,
    aqi: air.length ? Math.round(air.reduce((sum, n) => sum + (n.aqi || 0), 0) / air.length) : 0,
  }
}
