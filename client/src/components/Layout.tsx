import React, { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import { KeyRound, Check } from 'lucide-react'

// Apply saved text size on layout mount
const TEXT_SIZE_SCALES: Record<string, string> = { xs: '0.85', sm: '0.925', md: '1', lg: '1.1', xl: '1.2' }

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  useEffect(() => {
    const saved = localStorage.getItem('agenthub-text-size') || 'md'
    const scale = TEXT_SIZE_SCALES[saved] || '1'
    document.documentElement.style.fontSize = `${parseFloat(scale) * 16}px`
  }, [])
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyValue, setKeyValue] = useState(
    () => localStorage.getItem('agenthub_api_key') ?? ''
  )
  const [saved, setSaved] = useState(false)

  const saveKey = () => {
    localStorage.setItem('agenthub_api_key', keyValue)
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      setShowKeyInput(false)
    }, 1200)
  }

  const hasKey = Boolean(localStorage.getItem('agenthub_api_key'))

  return (
    <div className="min-h-screen bg-dark-bg text-slate-200 flex">
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 ml-60 flex flex-col min-h-screen">
        {/* Top header */}
        <header className="sticky top-0 z-20 h-14 bg-dark-sidebar/80 backdrop-blur border-b border-dark-border flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-300">⚡ AgentHub</span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-accent-purple/20 text-accent-purple border border-accent-purple/30">
              v1.0.0
            </span>
          </div>

          {/* API Key indicator */}
          <div className="relative">
            <button
              onClick={() => setShowKeyInput((v) => !v)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                hasKey
                  ? 'text-green-400 bg-green-500/10 border border-green-500/20 hover:bg-green-500/20'
                  : 'text-slate-400 bg-white/5 border border-dark-border hover:bg-white/10'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {hasKey ? 'API Key Set' : 'Set API Key'}
            </button>

            {showKeyInput && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-dark-card border border-dark-border rounded-lg shadow-xl p-4 z-50">
                <label className="block text-xs text-slate-400 mb-2">
                  X-API-Key (stored in localStorage)
                </label>
                <input
                  type="password"
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                  placeholder="Enter your API secret..."
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple"
                />
                <button
                  onClick={saveKey}
                  className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent-purple hover:bg-purple-600 text-white text-sm rounded-lg transition-colors"
                >
                  {saved ? <Check className="w-4 h-4" /> : null}
                  {saved ? 'Saved!' : 'Save Key'}
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
