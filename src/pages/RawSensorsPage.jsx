import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Badge, Card, Col, Nav, Row, Table } from 'react-bootstrap'
import ApexChart from '@/components/dashbyte/ApexChart'
import { CardNav, PageHeader } from '@/components/dashbyte/PageHeader'
import { LivePill } from '@/components/dashboard/RiskBadge'
import { api } from '@/lib/api'
import { RANGE_MAP } from '@/lib/adaptNetwork'
import {
  activityLine,
  analogSample,
  historySeries,
  HIDDEN_SENSOR_TYPES,
  primarySample,
  qualityMeta,
  rowsFromNodes,
  seenLabel,
  sensorMeta,
  valueRows,
} from '@/lib/rawSensors'

function rowKey(row) {
  return `${row.node_id}:${row.sensor_type}`
}

export function RawSensorsPage() {
  const { nodes, status: connection } = useOutletContext()
  const [rows, setRows] = useState([])
  const [loadError, setLoadError] = useState('')
  const [nodeFilter, setNodeFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedKey, setSelectedKey] = useState('')
  const [range, setRange] = useState('live')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await api.sensors()
        if (cancelled) return
        setRows((data.sensors || []).filter((row) => !HIDDEN_SENSOR_TYPES.has(row.sensor_type)))
        setLoadError('')
      } catch (err) {
        if (cancelled) return
        setLoadError(err.message || 'Sensor catalog unavailable')
      }
    }

    load()
    const timer = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const catalog = (rows.length ? rows : rowsFromNodes(nodes)).filter(
    (row) => !HIDDEN_SENSOR_TYPES.has(row.sensor_type),
  )

  const nodeIds = useMemo(
    () => [...new Set(catalog.map((row) => row.node_id))].sort(),
    [catalog],
  )

  const filtered = useMemo(() => {
    return catalog.filter((row) => {
      if (nodeFilter !== 'all' && row.node_id !== nodeFilter) return false
      if (typeFilter !== 'all' && row.node_type !== typeFilter) return false
      return true
    })
  }, [catalog, nodeFilter, typeFilter])

  const selected = filtered.find((row) => rowKey(row) === selectedKey) || filtered[0] || null

  useEffect(() => {
    if (!selected) {
      setHistory([])
      return undefined
    }
    let cancelled = false
    setHistoryLoading(true)
    api
      .nodeHistory(selected.node_id, selected.sensor_type, RANGE_MAP[range] || '1h')
      .then((data) => {
        if (cancelled) return
        setHistory(historySeries(data.points, selected.sensor_type))
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected?.node_id, selected?.sensor_type, range])

  const counts = useMemo(() => {
    const valid = catalog.filter((row) => row.quality_flag === 1).length
    const suspect = catalog.filter((row) => row.quality_flag === 0 || row.quality_flag === -1).length
    return {
      total: catalog.length,
      nodes: nodeIds.length,
      valid,
      suspect,
    }
  }, [catalog, nodeIds])

  const meta = selected ? sensorMeta(selected.sensor_type) : null
  const quality = selected ? qualityMeta(selected.quality_flag) : null
  const series = [{ name: meta?.label || 'Reading', data: history.map((point) => point.value) }]
  const options = {
    chart: { parentHeightOffset: 0, toolbar: { show: false }, zoom: { enabled: false } },
    colors: ['#506fd9'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2.4 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
    grid: { borderColor: 'rgba(72,94,144, 0.07)' },
    xaxis: {
      categories: history.map((point) =>
        new Date(point.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ),
      labels: { style: { fontSize: '11px' } },
    },
    yaxis: { labels: { style: { fontSize: '11px', colors: ['#a2abb5'] } } },
    tooltip: { enabled: true },
  }

  return (
    <>
      <div className="d-flex align-items-center justify-content-between">
        <PageHeader crumb="Raw Sensors" title="Raw sensor telemetry" actions={false} />
        <LivePill live={connection === 'live'} />
      </div>

      {loadError && catalog.length === 0 ? (
        <div className="alert alert-warning" role="status">
          {loadError}
        </div>
      ) : null}

      <Row className="g-3 mb-3">
        <Col sm="3">
          <Card className="card-one">
            <Card.Body>
              <label className="card-title fw-medium text-dark mb-1">Mounted sensors</label>
              <h3 className="card-value mb-0">{counts.total}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="3">
          <Card className="card-one">
            <Card.Body>
              <label className="card-title fw-medium text-dark mb-1">Nodes</label>
              <h3 className="card-value mb-0">{counts.nodes}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="3">
          <Card className="card-one">
            <Card.Body>
              <label className="card-title fw-medium text-dark mb-1">Valid samples</label>
              <h3 className="card-value text-success mb-0">{counts.valid}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="3">
          <Card className="card-one">
            <Card.Body>
              <label className="card-title fw-medium text-dark mb-1">Suspect / fault</label>
              <h3 className="card-value mb-0">{counts.suspect}</h3>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3">
        <Col xs="12">
          <Card className="card-one">
            <Card.Body className="d-flex flex-wrap align-items-center gap-3">
              <Nav variant="pills">
                {[['all', 'All nodes'], ...nodeIds.map((id) => [id, id])].map(([value, label]) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={nodeFilter === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setNodeFilter(value)
                      }}
                    >
                      {label}
                    </Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
              <Nav variant="pills">
                {[
                  ['all', 'All types'],
                  ['forest', 'Forest'],
                  ['water', 'Water'],
                  ['atmosphere', 'Atmosphere'],
                ].map(([value, label]) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={typeFilter === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setTypeFilter(value)
                      }}
                    >
                      {label}
                    </Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
              <Badge bg="light" text="dark" className="ms-auto">
                {filtered.length} shown
              </Badge>
            </Card.Body>
          </Card>
        </Col>

        <Col xl="7">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Live catalog</Card.Title>
              <CardNav />
            </Card.Header>
            <Card.Body className="p-0">
              {filtered.length === 0 ? (
                <p className="fs-sm text-secondary p-3 mb-0">No sensors mounted yet. Start the backend so the simulator can write readings.</p>
              ) : (
                <Table hover responsive className="table-one mb-0">
                  <thead>
                    <tr>
                      <th>Sensor</th>
                      <th>Node</th>
                      <th>Latest</th>
                      <th>Quality</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const itemMeta = sensorMeta(row.sensor_type)
                      const itemQuality = qualityMeta(row.quality_flag)
                      const active = selected && rowKey(row) === rowKey(selected)
                      return (
                        <tr
                          key={rowKey(row)}
                          role="button"
                          className={active ? 'table-active' : ''}
                          onClick={() => setSelectedKey(rowKey(row))}
                        >
                          <td>
                            <div className="d-flex align-items-start gap-2">
                              <i className={`${itemMeta.icon} fs-18 text-primary mt-1`} />
                              <div>
                                <div className="fw-semibold">{itemMeta.label}</div>
                                <div className="fs-11 text-secondary">{row.description || itemMeta.description}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <Link to={`/node/${row.node_id}`}>{row.node_id}</Link>
                            <div className="fs-11 text-secondary text-capitalize">{row.node_type}</div>
                          </td>
                          <td>
                            <div className="fw-semibold">{primarySample(row)}</div>
                            <div className="fs-11 text-secondary">{analogSample(row) || row.unit}</div>
                          </td>
                          <td>
                            <Badge bg={itemQuality.tone}>{itemQuality.label}</Badge>
                            <div className="fs-11 text-secondary text-capitalize">{row.source || '—'}</div>
                          </td>
                          <td className="fs-11 text-secondary">{seenLabel(row)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col xl="5">
          {selected && meta && quality ? (
            <Card className="card-one h-100">
              <Card.Header>
                <Card.Title as="h6">{meta.label}</Card.Title>
                <Badge bg={quality.tone}>{quality.label}</Badge>
              </Card.Header>
              <Card.Body>
                <p className="fs-sm mb-1">{selected.description || meta.description}</p>
                <p className="fw-medium mb-3">{activityLine(selected)}</p>
                <Table className="table-three mb-3">
                  <tbody>
                    <tr>
                      <td>Node</td>
                      <td colSpan="2">
                        <Link to={`/node/${selected.node_id}`}>{selected.node_name || selected.node_id}</Link>
                      </td>
                    </tr>
                    <tr>
                      <td>Registry name</td>
                      <td colSpan="2">
                        <code>{selected.sensor_type}</code>
                      </td>
                    </tr>
                    <tr>
                      <td>Unit</td>
                      <td colSpan="2">{selected.unit || meta.unit || '—'}</td>
                    </tr>
                    <tr>
                      <td>Source</td>
                      <td colSpan="2" className="text-capitalize">
                        {selected.source || '—'}
                      </td>
                    </tr>
                    <tr>
                      <td>Instance</td>
                      <td colSpan="2">{selected.instance_id ?? '—'}</td>
                    </tr>
                  </tbody>
                </Table>
                <label className="card-title fw-medium text-dark mb-2">Raw fields</label>
                <Row className="g-3 mb-3">
                  {valueRows(selected).map((field) => (
                    <Col xs="6" key={field.key}>
                      <label className="card-title fw-medium text-dark mb-1">{field.label}</label>
                      <h5 className="card-value mb-0">{field.display}</h5>
                    </Col>
                  ))}
                </Row>
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <label className="card-title fw-medium text-dark mb-0">History</label>
                  <Nav variant="pills">
                    {[
                      ['live', '1h'],
                      ['day', '24h'],
                      ['week', '7d'],
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
                </div>
                <ApexChart series={series} options={options} type="area" height={220} />
                {historyLoading ? <p className="fs-11 text-secondary mt-2 mb-0">Loading history…</p> : null}
              </Card.Body>
            </Card>
          ) : (
            <Card className="card-one">
              <Card.Body>
                <p className="fs-sm text-secondary mb-0">Select a sensor to inspect raw fields and history.</p>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>
    </>
  )
}
