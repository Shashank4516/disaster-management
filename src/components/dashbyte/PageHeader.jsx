import { Link } from 'react-router-dom'
import { Nav, OverlayTrigger, Tooltip } from 'react-bootstrap'

export function PageHeader({ crumb, title, actions = true }) {
  return (
    <div className="d-flex align-items-center justify-content-between mb-4">
      <div>
        <ol className="breadcrumb fs-sm mb-1">
          <li className="breadcrumb-item">
            <Link to="/">Dashboard</Link>
          </li>
          <li className="breadcrumb-item active" aria-current="page">
            {crumb}
          </li>
        </ol>
        <h4 className="main-title mb-0">{title}</h4>
      </div>

      {actions ? (
        <Nav as="nav" className="nav-icon nav-icon-lg">
          <OverlayTrigger overlay={<Tooltip>Share</Tooltip>}>
            <Nav.Link href="" onClick={(e) => e.preventDefault()}>
              <i className="ri-share-line" />
            </Nav.Link>
          </OverlayTrigger>
          <OverlayTrigger overlay={<Tooltip>Print</Tooltip>}>
            <Nav.Link href="" onClick={(e) => e.preventDefault()}>
              <i className="ri-printer-line" />
            </Nav.Link>
          </OverlayTrigger>
          <OverlayTrigger overlay={<Tooltip>Report</Tooltip>}>
            <Nav.Link href="" onClick={(e) => e.preventDefault()}>
              <i className="ri-bar-chart-2-line" />
            </Nav.Link>
          </OverlayTrigger>
        </Nav>
      ) : null}
    </div>
  )
}

export function CardNav() {
  return (
    <Nav className="nav-icon nav-icon-sm ms-auto">
      <Nav.Link href="" onClick={(e) => e.preventDefault()}>
        <i className="ri-refresh-line" />
      </Nav.Link>
      <Nav.Link href="" onClick={(e) => e.preventDefault()}>
        <i className="ri-more-2-fill" />
      </Nav.Link>
    </Nav>
  )
}
