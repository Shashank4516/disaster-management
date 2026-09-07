import { Link } from 'react-router-dom'
import { Card, Table } from 'react-bootstrap'
import { CardNav } from '@/components/dashbyte/PageHeader'
import { RiskBadge } from '@/components/dashboard/RiskBadge'
import { NODE_TYPES, formatRelative, readingSummary } from '@/lib/sensors'

export function NodeTable({ nodes }) {
  return (
    <Card className="card-one">
      <Card.Header>
        <Card.Title as="h6">Sensor nodes</Card.Title>
        <CardNav />
      </Card.Header>
      <Card.Body>
        <Table className="table-one" responsive>
          <thead>
            <tr>
              <th>Node</th>
              <th>Type</th>
              <th>Reading</th>
              <th>Risk</th>
              <th>Health</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id}>
                <td>
                  <div className="d-flex align-items-center fw-medium">
                    <i className={`${NODE_TYPES[node.type].icon} fs-24 lh-1 me-2`} />
                    <div>
                      <Link to={`/node/${node.id}`}>{node.name}</Link>
                      <div className="fs-11 text-secondary">
                        {node.id} · {node.city}
                      </div>
                    </div>
                  </div>
                </td>
                <td>{NODE_TYPES[node.type].label}</td>
                <td>{readingSummary(node)}</td>
                <td>
                  <RiskBadge risk={node.risk} />
                </td>
                <td>
                  {node.status} · {Math.round(node.battery)}% · {Math.round(node.signalDbm)} dBm
                </td>
                <td>{formatRelative(node.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  )
}
