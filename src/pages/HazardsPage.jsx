import { Link, useOutletContext } from 'react-router-dom'
import { Card, Col, Row } from 'react-bootstrap'
import { RiskBadge } from '@/components/dashboard/RiskBadge'
import { PageHeader } from '@/components/dashbyte/PageHeader'
import { NODE_TYPES, formatRelative, readingSummary } from '@/lib/sensors'

const sections = [
  { key: 'water', ...NODE_TYPES.water, blurb: 'Water level, rainfall, turbidity, and pressure for flood belts.' },
  { key: 'forest', ...NODE_TYPES.forest, blurb: 'MQ-135 gas, temperature, humidity, and pressure across forest corridors.' },
  { key: 'atmosphere', ...NODE_TYPES.atmosphere, blurb: 'PM2.5 / PM10 converted to AQI for urban corridors.' },
]

export function HazardsPage() {
  const { nodes } = useOutletContext()

  return (
    <>
      <PageHeader crumb="Hazard Modules" title="Hazard modules" />
      <Row className="g-3">
        {sections.map((section) => {
          const list = nodes.filter((n) => n.type === section.key).sort((a, b) => b.riskScore - a.riskScore)
          return (
            <Col xs="12" key={section.key}>
              <Card className="card-one">
                <Card.Header>
                  <div className="d-flex align-items-center">
                    <div className="card-icon bg-primary me-2">
                      <i className={section.icon} />
                    </div>
                    <div>
                      <Card.Title as="h6" className="mb-0">
                        {section.hazardLabel}
                      </Card.Title>
                      <span className="fs-sm text-secondary">{section.blurb}</span>
                    </div>
                  </div>
                </Card.Header>
                <Card.Body>
                  <Row className="g-3">
                    {list.map((node) => (
                      <Col md="6" xl="4" key={node.id}>
                        <Link to={`/node/${node.id}`} className="text-decoration-none text-reset">
                          <div className="border rounded p-3 h-100">
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <div>
                                <h6 className="mb-0">{node.name}</h6>
                                <span className="fs-11 text-secondary">
                                  {node.city}, {node.region}
                                </span>
                              </div>
                              <RiskBadge risk={node.risk} />
                            </div>
                            <p className="fw-medium mb-1">{readingSummary(node)}</p>
                            <p className="fs-11 text-secondary mb-0">
                              Score {node.riskScore} · {formatRelative(node.lastSeen)}
                            </p>
                          </div>
                        </Link>
                      </Col>
                    ))}
                  </Row>
                </Card.Body>
              </Card>
            </Col>
          )
        })}
      </Row>
    </>
  )
}
