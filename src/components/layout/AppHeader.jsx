import React from 'react'
import { Link } from 'react-router-dom'
import Dropdown from 'react-bootstrap/Dropdown'
import { Avatar } from '@/components/dashbyte/Avatar'
import { formatRelative } from '@/lib/sensors'

const NotificationToggle = React.forwardRef(({ children, onClick }, ref) => (
  <button
    type="button"
    ref={ref}
    onClick={(event) => {
      event.preventDefault()
      onClick(event)
    }}
    className="header-icon-btn dropdown-link"
  >
    {children}
  </button>
))

NotificationToggle.displayName = 'NotificationToggle'

const hazardInitial = {
  flood: 'FL',
  fire: 'FI',
  pollution: 'AQ',
}

export function AppHeader({ onMenu, alerts = [], unackedCount = 0 }) {
  const recent = [...alerts].sort((a, b) => b.ts - a.ts).slice(0, 5)

  return (
    <header className="app-header">
      <button type="button" className="header-menu" onClick={onMenu} aria-label="Toggle navigation">
        <i className="ri-menu-2-line" />
      </button>

      <div className="header-search">
        <i className="ri-search-line" />
        <input type="search" placeholder="Search nodes, regions, alerts" />
      </div>

      <div className="header-actions">
        <Dropdown className="dropdown-notification ms-3 ms-xl-4" align="end">
          <Dropdown.Toggle as={NotificationToggle}>
            {unackedCount > 0 ? <small>{unackedCount > 9 ? '9+' : unackedCount}</small> : null}
            <i className="ri-notification-3-line" />
          </Dropdown.Toggle>
          <Dropdown.Menu className="mt-10-f me--10-f">
            <div className="dropdown-menu-header">
              <h6 className="dropdown-menu-title">Notifications</h6>
            </div>
            {recent.length === 0 ? <p className="header-empty">No open alerts.</p> : null}
            <ul className="list-group">
              {recent.map((item) => (
                <li className="list-group-item" key={item.id}>
                  <Avatar
                    initial={hazardInitial[item.hazard] || 'EN'}
                    status={item.status === 'resolved' ? 'offline' : 'online'}
                  />
                  <div className="list-group-body">
                    <p>
                      <Link to={`/node/${item.nodeId}`}>{item.title}</Link>
                    </p>
                    <span>{formatRelative(item.ts)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="dropdown-menu-footer">
              <Link to="/alerts">Show all Notifications</Link>
            </div>
          </Dropdown.Menu>
        </Dropdown>

        <Dropdown align="end">
          <Dropdown.Toggle as="button" className="header-profile" type="button">
            <span className="operator-avatar">CR</span>
            <span className="header-profile-copy">
              <strong>Control Room</strong>
              <small>Operator</small>
            </span>
            <i className="ri-arrow-down-s-line" />
          </Dropdown.Toggle>
          <Dropdown.Menu className="header-dropdown">
            <Dropdown.Item as={Link} to="/settings">
              Account settings
            </Dropdown.Item>
            <Dropdown.Item as={Link} to="/">
              Sign out
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>
    </header>
  )
}
