import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toaster'
import Dashboard from './pages/Dashboard'
import Agents from './pages/Agents'
import Schedules from './pages/Schedules'
import Runs from './pages/Runs'
import Budgets from './pages/Budgets'
import Logs from './pages/Logs'

export default function App() {
  return (
    <ToastProvider>
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
    </ToastProvider>
  )
}
