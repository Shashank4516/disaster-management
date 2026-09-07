import { Link, useOutletContext } from 'react-router-dom'
import { Card, Col, ProgressBar, Row, Table } from 'react-bootstrap'
import ApexChart from '@/components/dashbyte/ApexChart'
import { CardNav } from '@/components/dashbyte/PageHeader'
import { AlertFeed } from '@/components/dashboard/AlertFeed'
import { LivePill, RiskBadge } from '@/components/dashboard/RiskBadge'
import { SensorMap } from '@/components/dashboard/SensorMap'
import { sparkOptions, sparkSeries } from '@/lib/apex'
import { NODE_TYPES, formatRelative, readingSummary } from '@/lib/sensors'

export function OverviewPage() {
  const { nodes, alerts, stats, ticks, acknowledgeAlert, escalateAlert, resolveAlert } = useOutletContext()
  const recent = [...alerts].sort((a, b) => b.ts - a.ts)
  const hot = [...nodes].sort((a, b) => b.riskScore - a.riskScore)
  const pct = (n) => Math.round((n / (stats.totalNodes || 1)) * 100)

  const sparkValues = (key) => ticks.map((t) => t[key])

  const metrics = [
    {
      value: stats.totalNodes,
      title: 'Total nodes',
      detail: `Water ${stats.byType.water} · Forest ${stats.byType.forest} · Air ${stats.byType.atmosphere}`,
      icon: 'ri-radar-line',
      tone: 'metric-blue',
      color: '#506fd9',
      spark: sparkSeries(sparkValues('online'), [5, 6, 5, 7, 6, 7, 7, 6, 7, 8, 7, 8]),
    },
    {
      value: stats.online,
      title: 'Online nodes',
      detail: `${stats.degraded} degraded · ${stats.offline} offline`,
      icon: 'ri-wifi-line',
      tone: 'metric-green',
      color: '#0cb785',
      spark: sparkSeries(sparkValues('online'), [5, 6, 7, 6, 7, 7, 6, 7, 6, 7, 7, 7]),
    },
    {
      value: stats.activeAlerts,
      title: 'Active alerts',
      detail: `${stats.criticalAlerts} critical · ${stats.warning} warning nodes`,
      icon: 'ri-alarm-warning-line',
      tone: 'metric-red',
      color: '#dc3545',
      spark: sparkSeries(sparkValues('alerts'), [2, 3, 2, 4, 5, 4, 3, 5, 4, 6, 5, 6]),
    },
    {
      value: stats.avgRisk,
      title: 'Network risk',
      detail: 'Composite score from live edge classification.',
      icon: 'ri-pulse-line',
      tone: 'metric-amber',
      color: '#fd7e14',
      spark: sparkSeries(sparkValues('avgRisk'), [40, 48, 52, 61, 58, 70, 66, 62, 68, 69, 71, 69]),
    },
  ]

  const trendSeries = [
    { name: 'Water level cm', data: ticks.map((t) => t.waterLevel) },
    { name: 'Forest gas ppm', data: ticks.map((t) => t.gas) },
    { name: 'AQI', data: ticks.map((t) => t.aqi) },
  ]

  const trendOptions = {
    chart: { parentHeightOffset: 0, toolbar: { show: false }, zoom: { enabled: false } },
    colors: ['#506fd9', '#fd7e14', '#0dcaf0'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2.2 },
    grid: { borderColor: 'rgba(72,94,144, 0.07)', padding: { left: 8, right: 8 } },
    legend: { show: true, fontSize: '11px' },
    xaxis: { labels: { show: false }, axisBorder: { show: false }, categories: ticks.map((_, i) => i + 1) },
    yaxis: { labels: { style: { fontSize: '11px', colors: ['#a2abb5'] } } },
    tooltip: { enabled: true },
  }

  const riskRows = [
    { dot: 'success', label: 'Normal', count: stats.byRisk.NORMAL, percent: pct(stats.byRisk.NORMAL) },
    { dot: 'warning', label: 'Watch', count: stats.byRisk.WATCH, percent: pct(stats.byRisk.WATCH) },
    { dot: 'orange', label: 'Warning', count: stats.byRisk.WARNING, percent: pct(stats.byRisk.WARNING) },
    { dot: 'danger', label: 'Critical', count: stats.byRisk.CRITICAL, percent: pct(stats.byRisk.CRITICAL) },
  ]

  return (
    <>
      <div className="page-heading">
        <div>
          <ol className="breadcrumb">
            <li className="breadcrumb-item">
              <Link to="/">Operations</Link>
            </li>
            <li className="breadcrumb-item active">Overview</li>
          </ol>
          <h1 className="main-title">Network overview</h1>
          <p className="page-description">Real-time environmental risk and infrastructure health across all regions.</p>
        </div>
        <LivePill />
      </div>

      <Row className="g-3">
        {metrics.map((metric) => {
          const values = metric.spark.values
          const delta = values.length > 1 ? values[values.length - 1] - values[0] : 0
          const deltaLabel = `${delta > 0 ? '+' : ''}${Number.isInteger(delta) ? delta : delta.toFixed(0)}`

          return (
            <Col md="6" xl="3" key={metric.title}>
              <Card className="card-one metric-card">
                <Card.Body className="metric-body">
                  <div className="metric-top">
                    <div className={`metric-icon ${metric.tone}`}>
                      <i className={metric.icon} />
                    </div>
                    <span className="metric-label">{metric.title}</span>
                    <span className={`metric-delta ${delta >= 0 ? 'up' : 'down'}`}>{deltaLabel}</span>
                  </div>
                  <div className="metric-value">{metric.value}</div>
                  <p className="metric-detail">{metric.detail}</p>
                </Card.Body>
                <div className="metric-chart">
                  <ApexChart
                    series={metric.spark.series}
                    options={sparkOptions(metric.color, metric.spark.values)}
                    type="area"
                    height={54}
                  />
                </div>
              </Card>
            </Col>
          )
        })}

        <Col lg="8">
          <Card className="card-one map-card h-100">
            <Card.Header>
              <Card.Title as="h6">Regional risk map</Card.Title>
            </Card.Header>
            <Card.Body className="p-0 map-card-body">
              <div className="sensor-map-embed">
                <SensorMap nodes={nodes} height="h-100" />
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col lg="4">
          <AlertFeed
            compact
            alerts={recent}
            onAcknowledge={acknowledgeAlert}
            onEscalate={escalateAlert}
            onResolve={resolveAlert}
          />
        </Col>

        <Col lg="8">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Live sensor output</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              <p className="fs-sm text-secondary mb-3">
                Aggregated from the same node readings as Node Detail. Values update every 2.5s.
              </p>
              <ApexChart series={trendSeries} options={trendOptions} type="line" height={260} />
            </Card.Body>
          </Card>
        </Col>
        <Col lg="4">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Risk mix</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              <h2 className="performance-value mb-0">{stats.critical}</h2>
              <label className="card-title fs-sm fw-medium">Critical nodes</label>
              <ProgressBar className="progress-one ht-8 mt-2 mb-4">
                <ProgressBar now={pct(stats.byRisk.NORMAL) || 1} variant="success" key={1} />
                <ProgressBar now={pct(stats.byRisk.WATCH) || 1} variant="warning" key={2} />
                <ProgressBar now={pct(stats.byRisk.WARNING) || 1} variant="orange" key={3} />
                <ProgressBar now={pct(stats.byRisk.CRITICAL) || 1} variant="danger" key={4} />
              </ProgressBar>
              <Table className="table-three">
                <tbody>
                  {riskRows.map((row) => (
                    <tr key={row.label}>
                      <td>
                        <div className={`badge-dot bg-${row.dot}`} />
                      </td>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td>{row.percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        <Col xs="12">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Highest-risk nodes</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              <Table className="table-one" responsive>
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Type</th>
                    <th>Live reading</th>
                    <th>Confidence</th>
                    <th>Risk</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {hot.map((node) => (
                    <tr key={node.id}>
                      <td>
                        <Link to={`/node/${node.id}`} className="fw-medium">
                          {node.name}
                        </Link>
                        <div className="fs-11 text-secondary">{node.id}</div>
                      </td>
                      <td>
                        <i className={`${NODE_TYPES[node.type].icon} me-1`} />
                        {NODE_TYPES[node.type].label}
                      </td>
                      <td>{readingSummary(node)}</td>
                      <td>{Math.round(node.confidence * 100)}%</td>
                      <td>
                        <RiskBadge risk={node.risk} />
                      </td>
                      <td>{formatRelative(node.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  )
}
