import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom'
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
import Organization from './pages/Organization'
import BusinessSetup from './pages/BusinessSetup'
import Costs from './pages/Costs'
import SettingsPage from './pages/Settings'
import Heartbeat from './pages/Heartbeat'
import Memory from './pages/Memory'
import Goals from './pages/Goals'
import ToolPolicies from './pages/ToolPolicies'
import Workflows from './pages/Workflows'
import { getSetupStatus } from './api/client'

function AppRoutes() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checked, setChecked] = useState(false)
  const [setupComplete, setSetupComplete] = useState(false)

  useEffect(() => {
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
        setSetupComplete(true)
      })
      .finally(() => setChecked(true))
  }, [navigate, location.pathname])

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
                <Route path="/organization" element={<Organization />} />
                <Route path="/business-setup" element={<BusinessSetup />} />
                <Route path="/costs" element={<Costs />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/heartbeat" element={<Heartbeat />} />
                <Route path="/memory" element={<Memory />} />
                <Route path="/goals" element={<Goals />} />
                <Route path="/tool-policies" element={<ToolPolicies />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route path="/proposals" element={<Navigate to="/organization" replace />} />
              </Routes>
            </Layout>
          }
        />
      </Routes>

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
