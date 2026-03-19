import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RotateCcw, Wallet } from 'lucide-react'
import { getBudgets, deleteBudget, resetBudget, Budget } from '../api/client'
import { useToast } from '../components/Toaster'
import Modal from '../components/Modal'
import BudgetForm from '../components/BudgetForm'

function formatCost(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(n)) return '$0.00'
  return `$${n.toFixed(2)}`
}

function BudgetCard({ budget }: { budget: Budget }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const limit = parseFloat(String(budget.limitUsd))
  const spend = parseFloat(String(budget.currentSpend))
  const pct = limit > 0 ? Math.min(100, (spend / limit) * 100) : 0

  const barColor =
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'
  const textColor =
    pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-yellow-400' : 'text-green-400'

  const resetMutation = useMutation({
    mutationFn: () => resetBudget(budget.agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      toast.success(`Budget for "${budget.agentName}" reset to $0`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteBudget(budget.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      toast.success('Budget deleted')
      setConfirmDelete(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <>
      <div className="bg-dark-card border border-dark-border rounded-xl p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-base font-semibold text-white">{budget.agentName}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-dark-bg border border-dark-border text-slate-400 capitalize">
                {budget.agentType}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-dark-bg border border-dark-border text-slate-400 capitalize">
                {budget.period}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              title="Reset spend to $0"
              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 disabled:opacity-30 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete budget"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-3">
          <div className="h-3 bg-dark-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Spend info */}
        <div className="flex items-center justify-between">
          <div>
            <span className={`text-lg font-bold ${textColor}`}>
              {formatCost(budget.currentSpend)}
            </span>
            <span className="text-sm text-slate-500"> / {formatCost(budget.limitUsd)}</span>
          </div>
          <span className={`text-sm font-medium ${textColor}`}>{pct.toFixed(1)}%</span>
        </div>

        {pct >= 90 && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">Budget nearly exhausted. Agent may be blocked.</p>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-dark-border">
          <p className="text-xs text-slate-500">
            Period started:{' '}
            {budget.periodStart ? new Date(budget.periodStart).toLocaleDateString() : '-'}
          </p>
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete Budget"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-slate-300 mb-4">
          Delete the{' '}
          <span className="capitalize text-white">{budget.period}</span> budget for{' '}
          <strong className="text-white">"{budget.agentName}"</strong>?
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium rounded-lg border border-dark-border transition-colors"
          >
            Cancel
          </button>
        </div>
      </Modal>
    </>
  )
}

export default function Budgets() {
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['budgets'],
    queryFn: getBudgets,
    refetchInterval: 30_000,
  })

  const budgets = data?.data ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Budgets</h1>
          <p className="text-sm text-slate-400 mt-1">
            Spending limits per agent
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Budget
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-48 text-red-400">
          <p className="text-sm">Failed to load budgets.</p>
        </div>
      ) : budgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 bg-dark-card border border-dark-border rounded-xl text-slate-500">
          <Wallet className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm font-medium">No budgets configured</p>
          <p className="text-xs mt-1">Set spending limits to control AI costs</p>
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple text-sm rounded-lg border border-accent-purple/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Budget
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {budgets.map((budget) => (
            <BudgetCard key={budget.id} budget={budget} />
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Budget">
        <BudgetForm onClose={() => setCreateOpen(false)} />
      </Modal>
    </div>
  )
}
