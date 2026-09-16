import { formatRelative } from '@/lib/sensors'

export const HIDDEN_SENSOR_TYPES = new Set(['flame', 'soil_moisture'])

export const SENSOR_CATALOG = {
  mq135_gas: {
    label: 'MQ-135 gas',
    unit: 'ppm',
    description: 'MQ-135 gas sensor',
    role: 'Samples VOC / smoke concentration against a rolling baseline.',
    icon: 'ri-windy-line',
    nodeTypes: ['forest'],
    primary: 'gas_ppm',
    analog: 'raw_voltage',
    historyKey: ['gas_ppm', 'avg_gas_ppm'],
  },
  ultrasonic_water_level: {
    label: 'Ultrasonic water level',
    unit: 'cm',
    description: 'JSN-SR04T water level sensor',
    role: 'Ranges the water surface and converts distance to channel level.',
    icon: 'ri-drop-line',
    nodeTypes: ['water'],
    primary: 'level_cm',
    analog: 'raw_distance_cm',
    historyKey: ['level_cm', 'avg_level_cm'],
  },
  rain_gauge: {
    label: 'Rain gauge',
    unit: 'mm',
    description: 'DIY tipping-bucket rain gauge',
    role: 'Counts bucket tips to estimate rainfall depth and intensity.',
    icon: 'ri-heavy-showers-line',
    nodeTypes: ['water'],
    primary: 'rainfall_rate_mmph',
    analog: 'tip_count',
    historyKey: ['rainfall_rate_mmph', 'max_rainfall_rate_mmph', 'rainfall_mm'],
  },
  turbidity: {
    label: 'Turbidity',
    unit: 'NTU',
    description: 'Turbidity sensor',
    role: 'Measures optical scatter as a flood / sediment proxy.',
    icon: 'ri-contrast-drop-2-line',
    nodeTypes: ['water'],
    primary: 'turbidity_ntu',
    analog: 'raw_voltage',
    historyKey: ['turbidity_ntu', 'avg_turbidity_ntu'],
  },
  dht22_temp: {
    label: 'DHT22 temperature',
    unit: 'C',
    description: 'DHT22 temperature',
    role: 'Records ambient air temperature at the node.',
    icon: 'ri-temp-hot-line',
    nodeTypes: ['forest', 'water'],
    primary: 'celsius',
    analog: null,
    historyKey: ['celsius', 'avg_celsius'],
  },
  dht22_humidity: {
    label: 'DHT22 humidity',
    unit: '%',
    description: 'DHT22 humidity',
    role: 'Records relative humidity at the node.',
    icon: 'ri-water-percent-line',
    nodeTypes: ['forest', 'water'],
    primary: 'relative_humidity_pct',
    analog: null,
    historyKey: ['relative_humidity_pct', 'avg_relative_humidity_pct'],
  },
  bmp280_pressure: {
    label: 'BMP280 pressure',
    unit: 'hPa',
    description: 'BMP280 barometric pressure',
    role: 'Tracks barometric pressure and short-term trend.',
    icon: 'ri-dashboard-3-line',
    nodeTypes: ['forest', 'water'],
    primary: 'pressure_hpa',
    analog: null,
    historyKey: ['pressure_hpa', 'avg_pressure_hpa'],
  },
  particulate: {
    label: 'Particulate',
    unit: 'µg/m³',
    description: 'PM2.5 / PM10 particulate sensor',
    role: 'Measures airborne particulates for an AQI-style score.',
    icon: 'ri-haze-line',
    nodeTypes: ['atmosphere'],
    primary: 'pm2_5_ugm3',
    analog: 'pm10_ugm3',
    historyKey: ['pm2_5_ugm3', 'avg_pm25'],
  },
}

const FIELD_LABELS = {
  detected: 'Flame detected',
  raw_value: 'Raw analog',
  raw_voltage: 'Raw voltage',
  gas_ppm: 'Gas',
  gas_deviation: 'Vs baseline',
  moisture_pct: 'Moisture',
  moisture_trend: 'Dryness trend',
  raw_distance_cm: 'Raw distance',
  level_cm: 'Water level',
  rate_of_rise: 'Rate of rise',
  tip_count: 'Tip count',
  rainfall_mm: 'Rainfall',
  rainfall_rate_mmph: 'Rain intensity',
  turbidity_ntu: 'Turbidity',
  turbidity_deviation: 'Vs baseline',
  celsius: 'Temperature',
  relative_humidity_pct: 'Humidity',
  pressure_hpa: 'Pressure',
  pressure_trend: 'Pressure trend',
  pm2_5_ugm3: 'PM2.5',
  pm10_ugm3: 'PM10',
  aqi_equivalent: 'AQI equivalent',
}

const FIELD_UNITS = {
  raw_voltage: 'V',
  gas_ppm: 'ppm',
  gas_deviation: 'ppm',
  moisture_pct: '%',
  raw_distance_cm: 'cm',
  level_cm: 'cm',
  rate_of_rise: 'cm/h',
  rainfall_mm: 'mm',
  rainfall_rate_mmph: 'mm/h',
  turbidity_ntu: 'NTU',
  celsius: '°C',
  relative_humidity_pct: '%',
  pressure_hpa: 'hPa',
  pm2_5_ugm3: 'µg/m³',
  pm10_ugm3: 'µg/m³',
}

export function sensorMeta(type) {
  return (
    SENSOR_CATALOG[type] || {
      label: type,
      unit: '',
      description: type,
      role: 'Field sensor on this node.',
      icon: 'ri-cpu-line',
      nodeTypes: [],
      primary: null,
      analog: null,
      historyKey: [],
    }
  )
}

export function qualityMeta(flag) {
  if (flag === 0) return { label: 'Suspect', tone: 'warning' }
  if (flag === -1) return { label: 'Fault', tone: 'danger' }
  if (flag === 1) return { label: 'Valid', tone: 'success' }
  return { label: 'Unknown', tone: 'secondary' }
}

export function formatSensorValue(value, unit = '') {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Detected' : 'Clear'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100
  return unit ? `${rounded} ${unit}` : String(rounded)
}

export function primarySample(row) {
  const meta = sensorMeta(row.sensor_type)
  const values = row.values || {}
  const unit = row.unit || meta.unit
  const displayUnit = unit === 'boolean' || unit === 'C' ? (unit === 'C' ? '°C' : '') : unit
  return formatSensorValue(values[meta.primary], displayUnit)
}

export function analogSample(row) {
  const meta = sensorMeta(row.sensor_type)
  if (!meta.analog) return null
  const values = row.values || {}
  return formatSensorValue(values[meta.analog], FIELD_UNITS[meta.analog] || '')
}

export function activityLine(row) {
  const meta = sensorMeta(row.sensor_type)
  const values = row.values || {}
  const primary = primarySample(row)
  if (!row.last_seen && (values == null || Object.keys(values).length === 0)) {
    return `${meta.role} Waiting for the first sample.`
  }
  switch (row.sensor_type) {
    case 'mq135_gas':
      return `Sampling VOC / smoke at ${primary}.`
    case 'ultrasonic_water_level':
      return `Ranging the water surface — level ${primary}.`
    case 'rain_gauge':
      return `Counting rain-gauge tips — intensity ${primary}.`
    case 'turbidity':
      return `Optical turbidity currently ${primary}.`
    case 'dht22_temp':
      return `Ambient temperature ${primary}.`
    case 'dht22_humidity':
      return `Relative humidity ${primary}.`
    case 'bmp280_pressure':
      return `Barometric pressure ${primary}.`
    default:
      return `${meta.role} Latest ${primary}.`
  }
}

export function valueRows(row) {
  const values = row.values || {}
  return Object.entries(values).map(([key, value]) => ({
    key,
    label: FIELD_LABELS[key] || key.replace(/_/g, ' '),
    display: formatSensorValue(value, FIELD_UNITS[key] || ''),
  }))
}

export function historySeries(points = [], sensorType) {
  const keys = sensorMeta(sensorType).historyKey
  return (points || []).map((point) => {
    const t = new Date(point.bucket || point.time).getTime()
    let value = null
    for (const key of keys) {
      if (point[key] !== undefined && point[key] !== null) {
        value = Number(point[key])
        break
      }
    }
    return { t, value: Number.isFinite(value) ? value : 0 }
  })
}

export function seenLabel(row) {
  if (!row.last_seen) return 'No sample yet'
  return formatRelative(new Date(row.last_seen).getTime())
}

export function rowsFromNodes(nodes = []) {
  return nodes.flatMap((node) =>
    (node.latestReadings || [])
      .filter((reading) => !HIDDEN_SENSOR_TYPES.has(reading.sensor_type))
      .map((reading) => {
      const meta = sensorMeta(reading.sensor_type)
      return {
        instance_id: reading.sensor_instance_id || `${node.id}:${reading.sensor_type}`,
        node_id: node.id,
        node_name: node.name,
        node_type: node.type,
        node_status: node.status,
        sensor_type: reading.sensor_type,
        unit: meta.unit,
        description: meta.description,
        active: true,
        last_seen: reading.time,
        quality_flag: reading.quality_flag,
        source: reading.source,
        values: reading.values || {},
      }
    }),
  )
}
