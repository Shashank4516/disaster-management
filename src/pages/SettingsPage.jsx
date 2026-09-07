import { Card, Col, Row } from 'react-bootstrap'
import { PageHeader } from '@/components/dashbyte/PageHeader'

const rows = [
  { label: 'Project', value: 'EnviroNet — SIH Environmental Monitoring' },
  { label: 'Stack (frontend)', value: 'React + Vite + Dashbyte + Leaflet' },
  { label: 'Data mode', value: 'Live mock ingest (swap useLiveNetwork for WebSocket)' },
  { label: 'Node types', value: 'Water · Forest · Atmosphere' },
  { label: 'Demo screen', value: 'Node Detail reflects live sensor output' },
]

export function SettingsPage() {
  return (
    <>
      <PageHeader crumb="Settings" title="Settings" />

      <Row className="g-3">
        <Col lg="6">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Project profile</Card.Title>
            </Card.Header>
            <Card.Body>
              {rows.map((row) => (
                <div key={row.label} className="d-flex justify-content-between align-items-center border rounded px-3 py-2 mb-2">
                  <span className="fs-11 text-secondary text-uppercase">{row.label}</span>
                  <span className="fs-sm fw-medium">{row.value}</span>
                </div>
              ))}
            </Card.Body>
          </Card>
        </Col>
        <Col lg="6">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Upcoming integrations</Card.Title>
            </Card.Header>
            <Card.Body>
              <ol className="mb-0 ps-3">
                <li className="mb-3">
                  <strong>Backend ingest API</strong>
                  <p className="fs-sm text-secondary mb-0">MQTT/HTTP device payloads, risk engine, alert persistence.</p>
                </li>
                <li className="mb-3">
                  <strong>ESP32 sensor nodes</strong>
                  <p className="fs-sm text-secondary mb-0">
                    Ultrasonic, smoke/gas, and PM sensors with edge thresholds.
                  </p>
                </li>
                <li>
                  <strong>Notification channel</strong>
                  <p className="fs-sm text-secondary mb-0">SMS / WhatsApp mock for authority & community alerts.</p>
                </li>
              </ol>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  )
}
