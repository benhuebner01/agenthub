import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Clock } from 'lucide-react'
import {
  getSchedules,
  deleteSchedule,
  enableSchedule,
  disableSchedule,
} from '../api/client'
import { useToast } from '../components/Toaster'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import ScheduleForm from '../components/ScheduleForm'

function formatDate(dt: string | null): string {
  if (!dt) return '-'
  return new Date(dt).toLocaleString()
}

export default function Schedules() {
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const qc = useQueryClient()
  const toast = useToast()

  const { data, isLoading, error } = useQuery({
    queryKey: ['schedules'],
    queryFn: getSchedules,
    refetchInterval: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Schedule deleted')
      setConfirmDeleteId(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const enableMutation = useMutation({
    mutationFn: (id: string) => enableSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Schedule enabled')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const disableMutation = useMutation({
    mutationFn: (id: string) => disableSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Schedule disabled')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const schedules = data?.data ?? []
  const confirmSchedule = schedules.find((s) => s.id === confirmDeleteId)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Schedules</h1>
          <p className="text-sm text-slate-400 mt-1">
            {data ? `${data.total} schedule${data.total !== 1 ? 's' : ''}` : 'Loading...'}
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Schedule
        </button>
      </div>

      <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-red-400">
            <p className="text-sm">Failed to load schedules.</p>
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <Clock className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No schedules yet</p>
            <p className="text-xs mt-1">Automate your agents with cron schedules</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple text-sm rounded-lg border border-accent-purple/30 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Schedule
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border">
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Agent
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Cron
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Next Run
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Last Run
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border">
                {schedules.map((schedule) => (
                  <tr key={schedule.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-slate-200 font-medium">{schedule.agentName}</p>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        {schedule.id.slice(0, 8)}...
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <code className="text-xs bg-dark-bg border border-dark-border px-2 py-0.5 rounded text-slate-300 font-mono">
                        {schedule.cronExpression}
                      </code>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">
                      {formatDate(schedule.nextRunAt)}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400">
                      {formatDate(schedule.lastRunAt)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={schedule.enabled ? 'enabled' : 'disabled'} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {/* Enable/Disable toggle */}
                        <button
                          onClick={() => {
                            if (schedule.enabled) {
                              disableMutation.mutate(schedule.id)
                            } else {
                              enableMutation.mutate(schedule.id)
                            }
                          }}
                          disabled={enableMutation.isPending || disableMutation.isPending}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${
                            schedule.enabled ? 'bg-accent-purple' : 'bg-slate-700'
                          }`}
                          title={schedule.enabled ? 'Disable' : 'Enable'}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              schedule.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(schedule.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Schedule">
        <ScheduleForm onClose={() => setCreateOpen(false)} />
      </Modal>

      <Modal
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete Schedule"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-slate-300 mb-4">
          Delete the schedule for{' '}
          <strong className="text-white">
            {confirmSchedule?.agentName ?? 'this agent'}
          </strong>
          ? (
          <code className="text-xs font-mono text-slate-400">
            {confirmSchedule?.cronExpression}
          </code>
          )
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)}
            disabled={deleteMutation.isPending}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDeleteId(null)}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium rounded-lg border border-dark-border transition-colors"
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  )
}
