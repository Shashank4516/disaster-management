export const RISK_LEVELS = {
  NORMAL: { label: 'Normal', color: '#0cb785', bg: '#e8faf3', variant: 'success' },
  WATCH: { label: 'Watch', color: '#ca8a04', bg: '#fef9c3', variant: 'warning' },
  WARNING: { label: 'Warning', color: '#fd7e14', bg: '#ffedd5', variant: 'orange' },
  CRITICAL: { label: 'Critical', color: '#dc3545', bg: '#fee2e2', variant: 'danger' },
}

export const NODE_TYPES = {
  water: {
    label: 'Water',
    hazard: 'flood',
    hazardLabel: 'Flood',
    icon: 'ri-drop-line',
    color: '#506fd9',
  },
  forest: {
    label: 'Forest',
    hazard: 'fire',
    hazardLabel: 'Forest fire',
    icon: 'ri-fire-line',
    color: '#fd7e14',
  },
  atmosphere: {
    label: 'Atmosphere',
    hazard: 'pollution',
    hazardLabel: 'Air quality',
    icon: 'ri-windy-line',
    color: '#0dcaf0',
  },
}

export const HAZARDS = {
  flood: NODE_TYPES.water,
  fire: NODE_TYPES.forest,
  pollution: NODE_TYPES.atmosphere,
}

const RISK_RANK = { NORMAL: 0, WATCH: 1, WARNING: 2, CRITICAL: 3 }

export function formatRelative(ts) {
  const diff = Math.max(0, Date.now() - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function clamp(n, min, max) {
  return Math.round(Math.max(min, Math.min(max, n)) * 10) / 10
}

function band(value, watch, warning, critical, invert = false) {
  if (invert) {
    if (value <= critical) return 'CRITICAL'
    if (value <= warning) return 'WARNING'
    if (value <= watch) return 'WATCH'
    return 'NORMAL'
  }
  if (value >= critical) return 'CRITICAL'
  if (value >= warning) return 'WARNING'
  if (value >= watch) return 'WATCH'
  return 'NORMAL'
}

function worse(a, b) {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b
}

export function aqiFromPm(pm25, pm10) {
  return Math.round((Number(pm25) + Number(pm10)) / 1.8)
}

export function classifyNode(node) {
  const r = node.readings
  let risk = 'NORMAL'
  let trigger = ''
  let score = 12

  if (node.type === 'water') {
    const level = band(r.waterLevelCm, 80, 140, 180)
    const rise = band(r.rateOfRiseCmHr, 4, 10, 18)
    const rain = band(r.rainfallMmHr, 8, 18, 30)
    risk = worse(worse(level, rise), rain)
    score =
      Math.min(98, r.waterLevelCm / 2.2 + r.rateOfRiseCmHr * 2.4 + r.rainfallMmHr * 1.1)
    if (risk === 'CRITICAL') trigger = `Water ${r.waterLevelCm} cm · rise ${r.rateOfRiseCmHr} cm/hr`
    else if (risk === 'WARNING') trigger = `Water ${r.waterLevelCm} cm with rainfall ${r.rainfallMmHr} mm/hr`
    else trigger = `Water ${r.waterLevelCm} cm`
  } else if (node.type === 'forest') {
    const gas = band(r.gasPpm, 80, 150, 220)
    const dry = band(r.soilMoisturePct, 25, 15, 8, true)
    risk = worse(gas, dry)
    if (r.flameDetected || r.flameSustained) risk = 'CRITICAL'
    score = Math.min(98, r.gasPpm / 2.8 + (r.flameDetected ? 40 : 0) + Math.max(0, 30 - r.soilMoisturePct))
    trigger = r.flameDetected
      ? 'Flame detected'
      : `MQ-135 ${r.gasPpm} ppm · soil ${r.soilMoisturePct}%`
  } else {
    const aqi = aqiFromPm(r.pm25, r.pm10)
    risk = band(aqi, 100, 200, 300)
    score = Math.min(98, aqi / 3.4)
    trigger = `AQI ${aqi} · PM2.5 ${r.pm25}`
  }

  if (node.status === 'offline') {
    risk = worse(risk, 'WATCH')
  }

  const signalPenalty = Math.max(0, (-90 - node.signalDbm) / 20)
  const confidence = clamp(0.92 - signalPenalty - (node.status === 'degraded' ? 0.12 : 0), 0.45, 0.98)

  return {
    risk,
    riskScore: Math.round(Math.max(8, Math.min(98, score))),
    confidence,
    trigger,
    aqi: node.type === 'atmosphere' ? aqiFromPm(r.pm25, r.pm10) : undefined,
  }
}

export function snapshotValues(node) {
  const r = node.readings
  if (node.type === 'water') {
    return {
      waterLevelCm: r.waterLevelCm,
      rainfallMmHr: r.rainfallMmHr,
      turbidityNtu: r.turbidityNtu,
      rateOfRiseCmHr: r.rateOfRiseCmHr,
    }
  }
  if (node.type === 'forest') {
    return {
      gasPpm: r.gasPpm,
      soilMoisturePct: r.soilMoisturePct,
      flame: r.flameDetected ? 1 : 0,
    }
  }
  return {
    pm25: r.pm25,
    pm10: r.pm10,
    aqi: aqiFromPm(r.pm25, r.pm10),
  }
}

export function primaryMetric(node) {
  if (node.type === 'water') return { key: 'waterLevelCm', label: 'Water level (cm)', unit: 'cm' }
  if (node.type === 'forest') return { key: 'gasPpm', label: 'MQ-135 gas (ppm)', unit: 'ppm' }
  return { key: 'aqi', label: 'AQI', unit: '' }
}

export function readingFields(node) {
  const r = node.readings
  if (node.type === 'water') {
    return [
      { label: 'Water level', value: `${r.waterLevelCm} cm`, hint: `Rise ${r.rateOfRiseCmHr} cm/hr` },
      { label: 'Rainfall', value: `${r.rainfallMmHr} mm/hr`, hint: 'Accumulation rate' },
      { label: 'Turbidity', value: `${r.turbidityNtu} NTU`, hint: `Δ ${r.turbidityDelta} from baseline` },
      { label: 'Temperature', value: `${r.temperatureC}°C`, hint: 'Ambient' },
      { label: 'Humidity', value: `${r.humidityPct}%`, hint: 'Ambient' },
      { label: 'Pressure', value: `${r.pressureHpa} hPa`, hint: r.pressureTrend },
    ]
  }
  if (node.type === 'forest') {
    return [
      { label: 'Flame detection', value: r.flameDetected ? 'Detected' : 'Clear', hint: r.flameSustained ? 'Sustained' : 'Instantaneous' },
      { label: 'MQ-135 gas', value: `${r.gasPpm} ppm`, hint: `Δ ${r.gasDelta} vs baseline` },
      { label: 'Soil moisture', value: `${r.soilMoisturePct}%`, hint: r.drynessTrend },
      { label: 'Air temperature', value: `${r.temperatureC}°C`, hint: 'Canopy' },
    ]
  }
  return [
    { label: 'PM2.5', value: `${r.pm25} µg/m³`, hint: 'Fine particulate' },
    { label: 'PM10', value: `${r.pm10} µg/m³`, hint: 'Coarse particulate' },
    { label: 'AQI equivalent', value: String(aqiFromPm(r.pm25, r.pm10)), hint: 'Display score' },
    { label: 'CO', value: `${r.coPpm} ppm`, hint: 'Optional gas' },
    { label: 'NO₂', value: `${r.no2Ppb} ppb`, hint: 'Optional gas' },
  ]
}

export function readingSummary(node) {
  const r = node.readings
  if (node.type === 'water') return `${r.waterLevelCm} cm · ${r.rainfallMmHr} mm/hr`
  if (node.type === 'forest') {
    return `${r.flameDetected ? 'Flame · ' : ''}${r.gasPpm} ppm · soil ${r.soilMoisturePct}%`
  }
  return `AQI ${aqiFromPm(r.pm25, r.pm10)} · PM2.5 ${r.pm25}`
}

export function seedHistory(node, points = 36) {
  const now = Date.now()
  const history = []
  for (let i = points; i >= 1; i -= 1) {
    const drift = (points - i) / points
    const sample = { t: now - i * 8 * 60_000 }
    if (node.type === 'water') {
      sample.waterLevelCm = clamp(node.readings.waterLevelCm - 18 + drift * 22 + Math.sin(i / 3) * 6, 20, 260)
      sample.rainfallMmHr = clamp(node.readings.rainfallMmHr - 4 + drift * 5, 0, 40)
      sample.turbidityNtu = clamp(node.readings.turbidityNtu - 8 + drift * 10, 4, 80)
      sample.rateOfRiseCmHr = clamp(node.readings.rateOfRiseCmHr - 1 + drift * 2, 0, 24)
    } else if (node.type === 'forest') {
      sample.gasPpm = clamp(node.readings.gasPpm - 40 + drift * 50 + Math.sin(i / 2) * 12, 20, 340)
      sample.soilMoisturePct = clamp(node.readings.soilMoisturePct + 6 - drift * 8, 6, 55)
      sample.flame = 0
    } else {
      sample.pm25 = clamp(node.readings.pm25 - 30 + drift * 40 + Math.sin(i / 4) * 10, 18, 380)
      sample.pm10 = clamp(node.readings.pm10 - 40 + drift * 50, 24, 420)
      sample.aqi = aqiFromPm(sample.pm25, sample.pm10)
    }
    history.push(sample)
  }
  return history
}

export function tickNode(node) {
  if (node.status === 'offline') {
    return { ...node, lastSeen: node.lastSeen }
  }

  const r = { ...node.readings }
  if (node.type === 'water') {
    r.waterLevelCm = clamp(r.waterLevelCm + (Math.random() * 5 - 1.8), 20, 260)
    r.rainfallMmHr = clamp(r.rainfallMmHr + (Math.random() * 1.6 - 0.5), 0, 42)
    r.rateOfRiseCmHr = clamp(r.rateOfRiseCmHr + (Math.random() * 0.9 - 0.35), 0, 24)
    r.turbidityNtu = clamp(r.turbidityNtu + (Math.random() * 3 - 1), 4, 90)
    r.turbidityDelta = clamp(r.turbidityNtu - 12, -8, 70)
    r.temperatureC = clamp(r.temperatureC + (Math.random() * 0.6 - 0.3), 18, 38)
    r.humidityPct = clamp(r.humidityPct + (Math.random() * 1.4 - 0.6), 35, 98)
    r.pressureHpa = clamp(r.pressureHpa + (Math.random() * 0.8 - 0.4), 990, 1024)
    r.pressureTrend = r.pressureHpa < 1005 ? 'Falling (3–6h)' : r.pressureHpa > 1014 ? 'Rising' : 'Stable'
  } else if (node.type === 'forest') {
    r.gasPpm = clamp(r.gasPpm + (Math.random() * 16 - 5), 18, 340)
    r.gasDelta = clamp(r.gasPpm - 70, -40, 260)
    r.soilMoisturePct = clamp(r.soilMoisturePct + (Math.random() * 1.2 - 0.7), 6, 55)
    r.drynessTrend = r.soilMoisturePct < 18 ? 'Multi-day drying' : 'Moist'
    r.temperatureC = clamp(r.temperatureC + (Math.random() * 0.8 - 0.3), 22, 46)
    r.flameDetected = r.gasPpm > 240 && Math.random() > 0.72
    r.flameSustained = r.flameDetected && r.gasPpm > 260
  } else {
    r.pm25 = clamp(r.pm25 + (Math.random() * 10 - 3.5), 16, 380)
    r.pm10 = clamp(r.pm10 + (Math.random() * 12 - 4), 22, 430)
    r.coPpm = clamp(r.coPpm + (Math.random() * 0.4 - 0.15), 0.2, 12)
    r.no2Ppb = clamp(r.no2Ppb + (Math.random() * 2 - 0.7), 8, 90)
  }

  const battery = clamp(node.battery - (Math.random() * 0.08), 8, 100)
  const signalDbm = clamp(node.signalDbm + (Math.random() * 3 - 1.5), -110, -40)
  const status = battery < 20 ? 'degraded' : node.status === 'degraded' && battery > 35 ? 'online' : node.status === 'offline' ? 'offline' : 'online'

  const next = {
    ...node,
    readings: r,
    battery,
    signalDbm,
    status,
    lastSeen: Date.now() - Math.floor(Math.random() * 4000),
  }
  const classified = classifyNode(next)
  const history = [...(node.history || []), { t: Date.now(), ...snapshotValues({ ...next, ...classified }) }].slice(-48)

  return {
    ...next,
    ...classified,
    history,
  }
}

export function networkMetrics(nodes, alerts) {
  const online = nodes.filter((n) => n.status === 'online').length
  const offline = nodes.filter((n) => n.status === 'offline').length
  const degraded = nodes.filter((n) => n.status === 'degraded').length
  const byRisk = {
    NORMAL: nodes.filter((n) => n.risk === 'NORMAL').length,
    WATCH: nodes.filter((n) => n.risk === 'WATCH').length,
    WARNING: nodes.filter((n) => n.risk === 'WARNING').length,
    CRITICAL: nodes.filter((n) => n.risk === 'CRITICAL').length,
  }
  const byType = {
    water: nodes.filter((n) => n.type === 'water').length,
    forest: nodes.filter((n) => n.type === 'forest').length,
    atmosphere: nodes.filter((n) => n.type === 'atmosphere').length,
  }
  const active = alerts.filter((a) => a.status !== 'resolved')
  return {
    totalNodes: nodes.length,
    online,
    offline,
    degraded,
    critical: byRisk.CRITICAL,
    warning: byRisk.WARNING,
    byRisk,
    byType,
    activeAlerts: active.length,
    criticalAlerts: active.filter((a) => a.severity === 'CRITICAL').length,
    avgRisk: Math.round(nodes.reduce((s, n) => s + n.riskScore, 0) / (nodes.length || 1)),
  }
}

export function buildAlertFromNode(node) {
  const type = NODE_TYPES[node.type]
  return {
    id: `ALT-${node.id}-${Date.now()}`,
    nodeId: node.id,
    area: `${node.city}, ${node.region}`,
    hazard: type.hazard,
    severity: node.risk,
    title: `${type.hazardLabel} ${node.risk.toLowerCase()} — ${node.name}`,
    message: node.trigger,
    action:
      node.risk === 'CRITICAL'
        ? 'Dispatch field team and issue public advisory.'
        : 'Increase monitoring cadence and notify regional desk.',
    ts: Date.now(),
    status: 'active',
    trigger: node.trigger,
    history: [{ action: 'opened', at: Date.now(), by: 'edge-engine' }],
  }
}

export function maybeOpenAlerts(prevNodes, nextNodes, alerts) {
  const open = new Set(
    alerts.filter((a) => a.status !== 'resolved').map((a) => `${a.nodeId}:${a.hazard}`),
  )
  const extra = []
  nextNodes.forEach((node, i) => {
    const prev = prevNodes[i]
    if (!prev) return
    const type = NODE_TYPES[node.type]
    const key = `${node.id}:${type.hazard}`
    const crossed = RISK_RANK[node.risk] >= RISK_RANK.WARNING && RISK_RANK[prev.risk] < RISK_RANK[node.risk]
    const stillHot = RISK_RANK[node.risk] >= RISK_RANK.WARNING && !open.has(key)
    if (crossed || stillHot) {
      extra.push(buildAlertFromNode(node))
      open.add(key)
    }
  })
  return extra.length ? [...extra, ...alerts].slice(0, 40) : alerts
}
