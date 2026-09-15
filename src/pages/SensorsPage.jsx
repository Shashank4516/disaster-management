import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Badge, Card, Col, Nav, Row } from 'react-bootstrap'
import { NodeTable } from '@/components/dashboard/NodeTable'
import { LivePill } from '@/components/dashboard/RiskBadge'
import { SensorMap } from '@/components/dashboard/SensorMap'
import { PageHeader } from '@/components/dashbyte/PageHeader'

export function SensorsPage() {
  const { nodes, status: connection } = useOutletContext()
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')

  const filtered = useMemo(() => {
    return nodes.filter((n) => {
      if (type !== 'all' && n.type !== type) return false
      if (status !== 'all' && n.status !== status) return false
      return true
    })
  }, [nodes, type, status])

  return (
    <>
      <div className="d-flex align-items-center justify-content-between">
        <PageHeader crumb="Regional Risk Map" title="Regional risk map" actions={false} />
        <LivePill live={connection === 'live'} />
      </div>

      <Row className="g-3 mb-3">
        <Col xs="12">
          <Card className="card-one">
            <Card.Body className="d-flex flex-wrap align-items-center gap-3">
              <Nav variant="pills">
                {[
                  ['all', 'All types'],
                  ['water', 'Water / flood'],
                  ['forest', 'Forest / fire'],
                  ['atmosphere', 'Atmosphere / AQI'],
                ].map(([value, label]) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={type === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setType(value)
                      }}
                    >
                      {label}
                    </Nav.Link>
                  </Nav.Item>
                ))}
              </Nav>
              <Nav variant="pills">
                {[
                  ['all', 'Any status'],
                  ['online', 'Online'],
                  ['degraded', 'Degraded'],
                  ['offline', 'Offline'],
                ].map(([value, label]) => (
                  <Nav.Item key={value}>
                    <Nav.Link
                      href=""
                      active={status === value}
                      onClick={(e) => {
                        e.preventDefault()
                        setStatus(value)
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
        <Col xs="12">
          <Card className="card-one">
            <Card.Body className="p-0">
              <div className="sensor-map-embed" style={{ height: 420 }}>
                <SensorMap nodes={filtered} height="h-100" />
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs="12">
          <NodeTable nodes={filtered} />
        </Col>
      </Row>
    </>
  )
}
