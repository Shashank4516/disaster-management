import { useMemo, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { Card, Col, Nav, Row, Table } from 'react-bootstrap'
import ApexChart from '@/components/dashbyte/ApexChart'
import { CardNav } from '@/components/dashbyte/PageHeader'
import { LivePill, RiskBadge } from '@/components/dashboard/RiskBadge'
import { NODE_TYPES, formatRelative, primaryMetric, readingFields } from '@/lib/sensors'

export function NodeDetailPage() {
  const { nodeId } = useParams()
  const { nodes, alerts } = useOutletContext()
  const [range, setRange] = useState('live')
  const node = nodes.find((n) => n.id === nodeId)

  const nodeAlerts = useMemo(
    () => alerts.filter((a) => a.nodeId === nodeId).sort((a, b) => b.ts - a.ts),
    [alerts, nodeId],
  )

  if (!node) {
    return (
      <Card className="card-one">
        <Card.Body>
          <p className="mb-2">Node not found.</p>
          <Link to="/sensors">Back to sensor network</Link>
        </Card.Body>
      </Card>
    )
  }

  const type = NODE_TYPES[node.type]
  const metric = primaryMetric(node)
  const take = range === 'live' ? 16 : range === 'day' ? 32 : 48
  const history = (node.history || []).slice(-take)
  const series = [{ name: metric.label, data: history.map((p) => p[metric.key] ?? 0) }]
  const options = {
    chart: { parentHeightOffset: 0, toolbar: { show: false }, zoom: { enabled: false } },
    colors: [type.color],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2.4 },
    fill: {
      type: 'gradient',
      gradient: { opacityFrom: 0.35, opacityTo: 0.05 },
    },
    grid: { borderColor: 'rgba(72,94,144, 0.07)' },
    xaxis: {
      categories: history.map((p) => new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      labels: { style: { fontSize: '11px' } },
    },
    yaxis: { labels: { style: { fontSize: '11px', colors: ['#a2abb5'] } } },
    tooltip: { enabled: true },
  }

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <ol className="breadcrumb fs-sm mb-1">
            <li className="breadcrumb-item">
              <Link to="/">Dashboard</Link>
            </li>
            <li className="breadcrumb-item">
              <Link to="/sensors">Sensor network</Link>
            </li>
            <li className="breadcrumb-item active">{node.id}</li>
          </ol>
          <h4 className="main-title mb-0">{node.name}</h4>
        </div>
        <div className="d-flex align-items-center gap-2">
          <LivePill />
          <RiskBadge risk={node.risk} />
        </div>
      </div>

      <Row className="g-3">
        <Col md="4">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Node identity</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              <Table className="table-three">
                <tbody>
                  <tr>
                    <td>ID</td>
                    <td colSpan="2">{node.id}</td>
                  </tr>
                  <tr>
                    <td>Type</td>
                    <td colSpan="2">
                      {type.label} · {type.hazardLabel}
                    </td>
                  </tr>
                  <tr>
                    <td>Location</td>
                    <td colSpan="2">
                      {node.city}, {node.region}
                    </td>
                  </tr>
                  <tr>
                    <td>Deployed</td>
                    <td colSpan="2">{node.deployedAt}</td>
                  </tr>
                  <tr>
                    <td>Last seen</td>
                    <td colSpan="2">{formatRelative(node.lastSeen)}</td>
                  </tr>
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col md="4">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Health</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              <h2 className="performance-value mb-1">{Math.round(node.battery)}%</h2>
              <label className="card-title fs-sm fw-medium">Battery / power</label>
              <Table className="table-three mt-3">
                <tbody>
                  <tr>
                    <td>Status</td>
                    <td colSpan="2" className="text-capitalize">
                      {node.status}
                    </td>
                  </tr>
                  <tr>
                    <td>Signal</td>
                    <td colSpan="2">{Math.round(node.signalDbm)} dBm</td>
                  </tr>
                  <tr>
                    <td>Confidence</td>
                    <td colSpan="2">{Math.round(node.confidence * 100)}%</td>
                  </tr>
                  <tr>
                    <td>Risk score</td>
                    <td colSpan="2">{node.riskScore}</td>
                  </tr>
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
        <Col md="4">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Classification</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              <p className="fs-sm mb-2">Current computed risk from live sensor output.</p>
              <p className="fw-semibold mb-1">{node.trigger}</p>
              <p className="fs-11 text-secondary mb-0">Edge engine · updates without page reload</p>
            </Card.Body>
          </Card>
        </Col>

        <Col xs="12">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Live readings</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              <Row className="g-3">
                {readingFields(node).map((field) => (
                  <Col md="4" xl="2" key={field.label}>
                    <label className="card-title fw-medium text-dark mb-1">{field.label}</label>
                    <h4 className="card-value mb-1">{field.value}</h4>
                    <span className="d-block text-muted fs-11">{field.hint}</span>
                  </Col>
                ))}
              </Row>
            </Card.Body>
          </Card>
        </Col>

        <Col lg="8">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">{metric.label} trend</Card.Title>
              <Nav variant="pills" className="ms-auto">
                {[
                  ['live', 'Last hour'],
                  ['day', '24h'],
                  ['week', '7 days'],
                ].map(([value, label]) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={range === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setRange(value)
                      }}
                    >
                      {label}
                    </Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
            </Card.Header>
            <Card.Body>
              <ApexChart series={series} options={options} type="area" height={280} />
            </Card.Body>
          </Card>
        </Col>
        <Col lg="4">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Alert history</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body>
              {nodeAlerts.length === 0 ? <p className="fs-sm text-secondary mb-0">No alerts for this node yet.</p> : null}
              {nodeAlerts.map((alert) => (
                <div key={alert.id} className="border-bottom pb-2 mb-2">
                  <div className="d-flex justify-content-between gap-2">
                    <RiskBadge risk={alert.severity} />
                    <span className="fs-11 text-secondary text-uppercase">{alert.status}</span>
                  </div>
                  <p className="fs-sm mb-0 mt-1">{alert.message}</p>
                  <p className="fs-11 text-secondary mb-0">{formatRelative(alert.ts)}</p>
                </div>
              ))}
              <Link className="fs-sm" to="/alerts">
                Open alert management
              </Link>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  )
}
