import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import avatarImg from '@/assets/img/avatar.jpg'

const dashboardMenu = [
  { label: 'Overview', link: '/', icon: 'ri-dashboard-line', end: true },
  { label: 'Regional Map', link: '/sensors', icon: 'ri-radar-line' },
  { label: 'Raw Sensors', link: '/raw-sensors', icon: 'ri-cpu-line' },
  { label: 'Alert Management', link: '/alerts', icon: 'ri-alarm-warning-line' },
]

const applicationsMenu = [
  { label: 'Hazard Modules', link: '/hazards', icon: 'ri-flood-line' },
  { label: 'Settings', link: '/settings', icon: 'ri-settings-5-line' },
]

const hazardMenu = [
  { label: 'Flood Watch', link: '/hazards', icon: 'ri-drop-line' },
  { label: 'Fire Detection', link: '/hazards', icon: 'ri-fire-line' },
  { label: 'Air Quality', link: '/hazards', icon: 'ri-windy-line' },
]

function MenuList({ items, alertCount = 0, onNavigate }) {
  const location = useLocation()
  return (
    <ul className="nav nav-sidebar">
      {items.map((item) => (
        <li key={item.label} className="nav-item">
          <NavLink
            to={item.link}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => {
              const onNode = item.link === '/sensors' && location.pathname.startsWith('/node/')
              return isActive || onNode ? 'nav-link active' : 'nav-link'
            }}
          >
            <i className={item.icon} />
            <span>{item.label}</span>
            {item.link === '/alerts' && alertCount > 0 ? <span className="badge bg-danger">{alertCount}</span> : null}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

export function AppSidebar({ alertCount = 0, onNavigate }) {
  const [groups, setGroups] = useState({ dashboard: true, applications: true, hazards: true })

  const toggleGroup = (key) => {
    setGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const toggleFooterMenu = (event) => {
    event.preventDefault()
    event.currentTarget.closest('.sidebar')?.classList.toggle('footer-menu-show')
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <Link to="/" className="sidebar-logo" onClick={onNavigate}>
          environet
        </Link>
      </div>

      <div className="sidebar-body">
        <div className={`nav-group${groups.dashboard ? ' show' : ''}`}>
          <div className="nav-label" onClick={() => toggleGroup('dashboard')}>
            Dashboard
          </div>
          <MenuList items={dashboardMenu} alertCount={alertCount} onNavigate={onNavigate} />
        </div>
        <div className={`nav-group${groups.applications ? ' show' : ''}`}>
          <div className="nav-label" onClick={() => toggleGroup('applications')}>
            Applications
          </div>
          <MenuList items={applicationsMenu} onNavigate={onNavigate} />
        </div>
        <div className={`nav-group${groups.hazards ? ' show' : ''}`}>
          <div className="nav-label" onClick={() => toggleGroup('hazards')}>
            Hazard Focus
          </div>
          <MenuList items={hazardMenu} onNavigate={onNavigate} />
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-top">
          <div className="sidebar-footer-thumb">
            <img src={avatarImg} alt="" />
          </div>
          <div className="sidebar-footer-body">
            <h6>
              <Link to="/settings">Control Room</Link>
            </h6>
            <p>EnviroNet Operator</p>
          </div>
          <Link onClick={toggleFooterMenu} to="" className="dropdown-link">
            <i className="ri-arrow-down-s-line" />
          </Link>
        </div>
        <div className="sidebar-footer-menu">
          <nav className="nav">
            <Link to="/settings"><i className="ri-edit-2-line" /> Edit Profile</Link>
            <Link to="/settings"><i className="ri-profile-line" /> View Profile</Link>
          </nav>
          <hr />
          <nav className="nav">
            <Link to="/hazards"><i className="ri-question-line" /> Help Center</Link>
            <Link to="/settings"><i className="ri-lock-line" /> Privacy Settings</Link>
            <Link to="/settings"><i className="ri-user-settings-line" /> Account Settings</Link>
            <Link to="/"><i className="ri-logout-box-r-line" /> Log Out</Link>
          </nav>
        </div>
      </div>
    </div>
  )
}
