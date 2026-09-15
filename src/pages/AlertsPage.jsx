import { useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Col, Nav, Row, Table } from 'react-bootstrap'
import { PageHeader } from '@/components/dashbyte/PageHeader'
import { RiskBadge } from '@/components/dashboard/RiskBadge'
import { HAZARDS, formatRelative, hazardMeta } from '@/lib/sensors'

export function AlertsPage() {
  const { alerts, acknowledgeAlert, escalateAlert, resolveAlert } = useOutletContext()
  const [severity, setSeverity] = useState('all')
  const [hazard, setHazard] = useState('all')
  const [status, setStatus] = useState('open')

  const filtered = useMemo(() => {
    return alerts
      .filter((a) => {
        if (severity !== 'all' && a.severity !== severity) return false
        if (hazard !== 'all' && a.hazard !== hazard) return false
        if (status === 'open' && a.status === 'resolved') return false
        if (status !== 'all' && status !== 'open' && a.status !== status) return false
        return true
      })
      .sort((a, b) => b.ts - a.ts)
  }, [alerts, severity, hazard, status])

  const counts = useMemo(
    () => ({
      critical: alerts.filter((a) => a.severity === 'CRITICAL' && a.status !== 'resolved').length,
      warning: alerts.filter((a) => a.severity === 'WARNING' && a.status !== 'resolved').length,
      watch: alerts.filter((a) => a.severity === 'WATCH' && a.status !== 'resolved').length,
    }),
    [alerts],
  )

  return (
    <>
      <PageHeader crumb="Alert Management" title="Alert management" />

      <Row className="g-3 mb-3">
        <Col sm="4">
          <Card className="card-one">
            <Card.Body>
              <label className="card-title fw-medium text-dark mb-1">Open critical</label>
              <h3 className="card-value text-danger mb-0">{counts.critical}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="4">
          <Card className="card-one">
            <Card.Body>
              <label className="card-title fw-medium text-dark mb-1">Open warnings</label>
              <h3 className="card-value mb-0">{counts.warning}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col sm="4">
          <Card className="card-one">
            <Card.Body>
              <label className="card-title fw-medium text-dark mb-1">Open watch</label>
              <h3 className="card-value mb-0">{counts.watch}</h3>
            </Card.Body>
          </Card>
        </Col>
        <Col xs="12">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Filters</Card.Title>
            </Card.Header>
            <Card.Body className="d-flex flex-wrap gap-3">
              <Nav variant="pills">
                {['all', 'CRITICAL', 'WARNING', 'WATCH'].map((value) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={severity === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setSeverity(value)
                      }}
                    >
                      {value === 'all' ? 'All severity' : value}
                    </Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
              <Nav variant="pills">
                {['all', 'flood', 'fire', 'pollution'].map((value) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={hazard === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setHazard(value)
                      }}
                    >
                      {value === 'all' ? 'All hazards' : HAZARDS[value].hazardLabel}
                    </Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
              <Nav variant="pills">
                {['open', 'active', 'acknowledged', 'escalated', 'resolved', 'all'].map((value) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={status === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setStatus(value)
                      }}
                    >
                      {value}
                    </Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
            </Card.Body>
          </Card>
        </Col>
        <Col xs="12">
          <Card className="card-one">
            <Card.Body>
              <Table className="table-one" responsive>
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Hazard</th>
                    <th>Node</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>When</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((alert) => (
                    <tr key={alert.id}>
                      <td>
                        <RiskBadge risk={alert.severity} />
                        <div className="fw-medium mt-1">{alert.title}</div>
                        <div className="fs-11 text-secondary">{alert.area}</div>
                      </td>
                      <td>{hazardMeta(alert.hazard).hazardLabel}</td>
                      <td>
                        <Link to={`/node/${alert.nodeId}`}>{alert.nodeId}</Link>
                      </td>
                      <td>{alert.trigger || alert.message}</td>
                      <td className="text-uppercase">{alert.status}</td>
                      <td>{formatRelative(alert.ts)}</td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {alert.status === 'active' ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={async () => {
                                try {
                                  await acknowledgeAlert(alert.id)
                                  toast.success('Alert acknowledged')
                                } catch {
                                  // hook already toasted the API error
                                }
                              }}
                            >
                              Ack
                            </Button>
                          ) : null}
                          {alert.status !== 'resolved' && alert.status !== 'escalated' ? (
                            <Button
                              size="sm"
                              variant="white"
                              onClick={async () => {
                                try {
                                  await escalateAlert(alert.id)
                                  toast.success('Alert escalated')
                                } catch {
                                  // hook already toasted the API error
                                }
                              }}
                            >
                              Escalate
                            </Button>
                          ) : null}
                          {alert.status !== 'resolved' ? (
                            <Button
                              size="sm"
                              variant="white"
                              onClick={async () => {
                                try {
                                  await resolveAlert(alert.id)
                                  toast.success('Alert resolved')
                                } catch {
                                  // hook already toasted the API error
                                }
                              }}
                            >
                              Resolve
                            </Button>
                          ) : null}
                        </div>
                      </td>
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
