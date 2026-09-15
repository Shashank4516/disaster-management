import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Card, Col, Form, Row } from 'react-bootstrap'
import { PageHeader } from '@/components/dashbyte/PageHeader'
import { api, DEFAULT_AUTH } from '@/lib/api'

export function SettingsPage() {
  const { status, error, user, login, logout, refresh, health } = useOutletContext()
  const [username, setUsername] = useState(DEFAULT_AUTH.username)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [db, setDb] = useState(null)
  const [ingest, setIngest] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.dbHealth().catch(() => null), api.ingestStatus().catch(() => null)]).then(([dbHealth, ingestStatus]) => {
      if (cancelled) return
      setDb(dbHealth)
      setIngest(ingestStatus)
    })
    return () => {
      cancelled = true
    }
  }, [status])

  async function onLogin(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await login(username, password || DEFAULT_AUTH.password)
      toast.success('Signed in')
      setPassword('')
    } catch (err) {
      toast.error(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  const rows = [
    { label: 'Project', value: 'EnviroNet — SIH Environmental Monitoring' },
    { label: 'Stack', value: 'React + Vite + Dashbyte · Express API + TimescaleDB' },
    { label: 'API', value: status === 'live' ? 'Connected (localhost:3000 via Vite proxy)' : error || 'Disconnected' },
    { label: 'Operator', value: user ? `${user.username} (${user.role})` : 'Not signed in' },
    { label: 'API uptime', value: health?.uptime ? `${Math.round(health.uptime)}s` : '—' },
    { label: 'Database', value: db?.status === 'up' ? `Up · ${db.timescaledbVersion || 'TimescaleDB'}` : db?.status || 'Unknown' },
    { label: 'Simulator', value: ingest?.simulatorRunning ? 'Writing live simulated readings' : 'Stopped / unknown' },
  ]

  return (
    <>
      <PageHeader crumb="Settings" title="Settings" />

      <Row className="g-3">
        <Col lg="6">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Runtime profile</Card.Title>
            </Card.Header>
            <Card.Body>
              {rows.map((row) => (
                <div key={row.label} className="d-flex justify-content-between align-items-center border rounded px-3 py-2 mb-2">
                  <span className="fs-11 text-secondary text-uppercase">{row.label}</span>
                  <span className="fs-sm fw-medium text-end ms-3">{row.value}</span>
                </div>
              ))}
              <Button size="sm" variant="white" className="mt-2" onClick={refresh}>
                Refresh connection
              </Button>
            </Card.Body>
          </Card>
        </Col>
        <Col lg="6">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Authority login</Card.Title>
            </Card.Header>
            <Card.Body>
              <p className="fs-sm text-secondary">
                Acknowledge / resolve / escalate require a JWT. Default demo account is{' '}
                <code>{DEFAULT_AUTH.username}</code> / <code>admin123</code>.
              </p>
              <Form onSubmit={onLogin} className="d-grid gap-2">
                <Form.Control
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                />
                <Form.Control
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                />
                <div className="d-flex gap-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Signing in…' : 'Sign in'}
                  </Button>
                  <Button
                    type="button"
                    variant="white"
                    onClick={() => {
                      logout()
                      toast.message('Signed out')
                    }}
                  >
                    Sign out
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
        <Col lg="12">
          <Card className="card-one">
            <Card.Header>
              <Card.Title as="h6">Backend</Card.Title>
            </Card.Header>
            <Card.Body>
              <p className="fs-sm text-secondary mb-3">
                The API lives in <code>Environet-BE/</code>. From the frontend folder:
              </p>
              <pre className="bg-light border rounded p-3 fs-sm mb-0">{`npm run backend
npm run dev`}</pre>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  )
}
