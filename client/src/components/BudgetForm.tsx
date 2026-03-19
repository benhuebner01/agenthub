import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAgents, createBudget, CreateBudgetDto } from '../api/client'
import { useToast } from './Toaster'

interface BudgetFormProps {
  onClose: () => void
}

const INPUT_CLASS =
  'w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors'

const LABEL_CLASS = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function BudgetForm({ onClose }: BudgetFormProps) {
  const qc = useQueryClient()
  const toast = useToast()

  const [agentId, setAgentId] = useState('')
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly')
  const [limitUsd, setLimitUsd] = useState('10')

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateBudgetDto) => createBudget(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      toast.success('Budget created successfully')
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!agentId) {
      toast.error('Please select an agent')
      return
    }
    const limit = parseFloat(limitUsd)
    if (isNaN(limit) || limit <= 0) {
      toast.error('Limit must be a positive number')
      return
    }
    createMutation.mutate({ agentId, period, limitUsd: limit })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Agent */}
      <div>
        <label className={LABEL_CLASS}>Agent *</label>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className={INPUT_CLASS}
          required
        >
          <option value="">Select an agent...</option>
          {agentsLoading && <option disabled>Loading agents...</option>}
          {agentsData?.data.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.type})
            </option>
          ))}
        </select>
      </div>

      {/* Period */}
      <div>
        <label className={LABEL_CLASS}>Reset Period</label>
        <div className="grid grid-cols-3 gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${
                period === p
                  ? 'bg-accent-purple/20 text-accent-purple border-accent-purple/40'
                  : 'bg-dark-bg text-slate-400 border-dark-border hover:border-accent-purple/30 hover:text-slate-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Limit */}
      <div>
        <label className={LABEL_CLASS}>Spending Limit (USD) *</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            $
          </span>
          <input
            type="number"
            value={limitUsd}
            onChange={(e) => setLimitUsd(e.target.value)}
            min="0.01"
            step="0.01"
            placeholder="10.00"
            className={INPUT_CLASS + ' pl-7'}
            required
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Agent will be blocked when {period} spend exceeds this limit.
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="flex-1 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {createMutation.isPending ? 'Creating...' : 'Create Budget'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium rounded-lg border border-dark-border transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
