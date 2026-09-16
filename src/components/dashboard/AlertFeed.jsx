import { Link } from 'react-router-dom'
import { Button, Card } from 'react-bootstrap'
import { CardNav } from '@/components/dashbyte/PageHeader'
import { RiskBadge } from '@/components/dashboard/RiskBadge'
import { formatRelative, hazardMeta } from '@/lib/sensors'

export function AlertFeed({ alerts, onAcknowledge, onEscalate, onResolve, compact = false }) {
  const list = compact ? alerts.slice(0, 5) : alerts

  return (
    <Card className="card-one h-100">
      <Card.Header>
        <Card.Title as="h6">{compact ? 'Critical / recent alerts' : 'Alert stream'}</Card.Title>
        <CardNav />
      </Card.Header>
      <Card.Body className={compact ? 'alert-feed-body' : undefined}>
        {list.length === 0 ? <p className="fs-sm text-secondary mb-0">No alerts in this view.</p> : null}
        {list.map((alert) => (
          <div key={alert.id} className="d-flex align-items-start mb-3 pb-3 border-bottom">
            <div className="card-icon bg-primary me-3" style={{ width: 40, height: 40 }}>
              <i className={hazardMeta(alert.hazard).icon} />
            </div>
            <div className="flex-fill">
              <div className="d-flex align-items-center gap-2 mb-1">
                <RiskBadge risk={alert.severity} />
                <Link to={`/node/${alert.nodeId}`} className="fw-semibold">
                  {alert.title}
                </Link>
                <span className="badge bg-light text-dark ms-auto text-uppercase">{alert.status}</span>
              </div>
              <p className="fs-sm text-secondary mb-1">{alert.message}</p>
              <p className="fs-11 text-secondary mb-2">
                {alert.area} · {alert.nodeId} · {formatRelative(alert.ts)}
              </p>
              {alert.status !== 'resolved' ? (
                <div className="d-flex flex-wrap gap-2">
                  {alert.status === 'active' && onAcknowledge ? (
                    <Button size="sm" variant="primary" onClick={() => onAcknowledge(alert.id)}>
                      Acknowledge
                    </Button>
                  ) : null}
                  {alert.status !== 'escalated' && onEscalate ? (
                    <Button size="sm" variant="white" onClick={() => onEscalate(alert.id)}>
                      Escalate
                    </Button>
                  ) : null}
                  {onResolve ? (
                    <Button size="sm" variant="white" onClick={() => onResolve(alert.id)}>
                      Resolve
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </Card.Body>
    </Card>
  )
}
