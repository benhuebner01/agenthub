import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toaster'
import InternalAgentChat from './components/InternalAgentChat'
import Dashboard from './pages/Dashboard'
import Agents from './pages/Agents'
import Schedules from './pages/Schedules'
import Runs from './pages/Runs'
import Budgets from './pages/Budgets'
import Logs from './pages/Logs'
import Setup from './pages/Setup'
import { getSetupStatus } from './api/client'

function AppRoutes() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checked, setChecked] = useState(false)
  const [setupComplete, setSetupComplete] = useState(false)

  useEffect(() => {
    // Don't redirect if already on /setup
    if (location.pathname === '/setup') {
      setChecked(true)
      return
    }

    getSetupStatus()
      .then((status) => {
        if (!status.complete) {
          navigate('/setup', { replace: true })
        } else {
          setSetupComplete(true)
        }
      })
      .catch(() => {
        // If the endpoint is unavailable or returns an error, don't block the app
        setSetupComplete(true)
      })
      .finally(() => setChecked(true))
  }, [navigate, location.pathname])

  // Avoid a flash of the main app before the redirect
  if (!checked && location.pathname !== '/setup') {
    return null
  }

  const isSetupPage = location.pathname === '/setup'

  return (
    <>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/schedules" element={<Schedules />} />
                <Route path="/runs" element={<Runs />} />
                <Route path="/budgets" element={<Budgets />} />
                <Route path="/logs" element={<Logs />} />
              </Routes>
            </Layout>
          }
        />
      </Routes>

      {/* Internal Agent Chat — always visible when setup is complete */}
      {!isSetupPage && setupComplete && <InternalAgentChat />}
    </>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  )
}
