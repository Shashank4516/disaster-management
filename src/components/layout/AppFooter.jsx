import { Link } from 'react-router-dom'

export function AppFooter() {
  return (
    <div className="main-footer">
      <span>&copy; {new Date().getFullYear()}. EnviroNet. All Rights Reserved.</span>
      <span>
        Environmental early-warning · <Link to="/sensors">Sensor network</Link>
      </span>
    </div>
  )
}
