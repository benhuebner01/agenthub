import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAgents, createSchedule, CreateScheduleDto } from '../api/client'
import { useToast } from './Toaster'

interface ScheduleFormProps {
  onClose: () => void
}

const INPUT_CLASS =
  'w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors'

const LABEL_CLASS = 'block text-xs font-medium text-slate-400 mb-1.5'

const CRON_EXAMPLES = [
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 9am', value: '0 9 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Every Monday 9am', value: '0 9 * * 1' },
  { label: 'Every weekday 9am', value: '0 9 * * 1-5' },
]

export default function ScheduleForm({ onClose }: ScheduleFormProps) {
  const qc = useQueryClient()
  const toast = useToast()

  const [agentId, setAgentId] = useState('')
  const [cronExpression, setCronExpression] = useState('0 * * * *')
  const [enabled, setEnabled] = useState(true)

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateScheduleDto) => createSchedule(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Schedule created successfully')
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
    if (!cronExpression.trim()) {
      toast.error('Cron expression is required')
      return
    }
    createMutation.mutate({ agentId, cronExpression: cronExpression.trim(), enabled })
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

      {/* Cron Expression */}
      <div>
        <label className={LABEL_CLASS}>Cron Expression *</label>
        <input
          type="text"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          placeholder="0 * * * *"
          className={INPUT_CLASS + ' font-mono'}
          required
        />
        {/* Quick presets */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CRON_EXAMPLES.map((ex) => (
            <button
              key={ex.value}
              type="button"
              onClick={() => setCronExpression(ex.value)}
              className="px-2 py-0.5 text-xs rounded bg-dark-bg border border-dark-border text-slate-400 hover:text-slate-200 hover:border-accent-purple/50 transition-colors font-mono"
            >
              {ex.value}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-xs text-slate-500">
          Format: minute hour day month weekday
          {CRON_EXAMPLES.map((ex) => (
            <span key={ex.value} className="ml-2 text-slate-600">
              &nbsp;·&nbsp;{ex.label}:{' '}
              <code className="font-mono text-slate-500">{ex.value}</code>
            </span>
          )).slice(0, 3)}
        </div>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-dark-bg border border-dark-border">
        <div>
          <p className="text-sm text-slate-200">Enabled</p>
          <p className="text-xs text-slate-500">Start schedule immediately after creation</p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-accent-purple' : 'bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="flex-1 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {createMutation.isPending ? 'Creating...' : 'Create Schedule'}
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
