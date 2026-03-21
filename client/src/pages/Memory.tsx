import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Brain,
  Building2,
  Bot,
  Plus,
  Trash2,
  Save,
  Edit3,
  X,
  ChevronRight,
} from 'lucide-react'
import {
  getOrganizations,
  getAgents,
  getOrgMemory,
  setOrgMemory,
  deleteOrgMemory,
  getAgentMemory,
  setAgentMemory,
  deleteAgentMemory,
  Organization,
  Agent,
  SharedMemoryEntry,
  AgentMemoryEntry,
} from '../api/client'
import { useToast } from '../components/Toaster'

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'org' | 'agent'

// ─── Memory Entry Card ──────────────────────────────────────────────────────

function MemoryCard({
  entryKey,
  value,
  updatedAt,
  onSave,
  onDelete,
}: {
  entryKey: string
  value: string
  updatedAt: string
  onSave: (newValue: string) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSave = () => {
    onSave(editValue)
    setEditing(false)
  }

  const handleCancel = () => {
    setEditValue(value)
    setEditing(false)
  }

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete()
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div className="border border-dark-border rounded-lg bg-dark-card hover:border-slate-600 transition-colors">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            size={14}
            className={`text-slate-500 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="text-sm font-medium text-white truncate">{entryKey}</span>
        </div>
        <span className="text-xs text-slate-500 flex-shrink-0 ml-3">
          {new Date(updatedAt).toLocaleString()}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-dark-border pt-3">
          {editing ? (
            <textarea
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent-purple resize-y min-h-[80px]"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={4}
            />
          ) : (
            <pre className="text-sm text-slate-300 whitespace-pre-wrap break-words bg-dark-bg rounded-lg px-3 py-2">
              {value}
            </pre>
          )}

          <div className="flex items-center justify-end gap-2 mt-3">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-dark-border rounded-lg hover:bg-dark-bg transition-colors"
                >
                  <X size={13} />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-accent-purple hover:bg-accent-purple/80 rounded-lg transition-colors"
                >
                  <Save size={13} />
                  Save
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditValue(value)
                    setEditing(true)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-dark-border rounded-lg hover:bg-dark-bg transition-colors"
                >
                  <Edit3 size={13} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    confirmDelete
                      ? 'text-white bg-red-600 hover:bg-red-700'
                      : 'text-red-400 hover:text-red-300 border border-dark-border hover:bg-dark-bg'
                  }`}
                >
                  <Trash2 size={13} />
                  {confirmDelete ? 'Confirm' : 'Delete'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Add Entry Form ──────────────────────────────────────────────────────────

function AddEntryForm({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')

  const handleSubmit = () => {
    if (!key.trim() || !value.trim()) return
    onAdd(key.trim(), value.trim())
    setKey('')
    setValue('')
  }

  return (
    <div className="border border-dark-border rounded-lg bg-dark-card p-4 mt-4">
      <h4 className="text-sm font-medium text-slate-300 mb-3">Add New Entry</h4>
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple"
        />
        <textarea
          placeholder="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple resize-y"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!key.trim() || !value.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-accent-purple hover:bg-accent-purple/80 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: typeof Brain; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      <Icon size={40} strokeWidth={1.2} className="mb-3 text-slate-600" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ─── Organization Memory Tab ─────────────────────────────────────────────────

function OrgMemoryTab() {
  const qc = useQueryClient()
  const toast = useToast()

  const { data: orgsData } = useQuery({ queryKey: ['organizations'], queryFn: getOrganizations })
  const orgs: Organization[] = orgsData?.data ?? []
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')

  const activeOrgId = selectedOrgId || orgs[0]?.id || ''

  const { data: memData, isLoading } = useQuery({
    queryKey: ['orgMemory', activeOrgId],
    queryFn: () => getOrgMemory(activeOrgId),
    enabled: !!activeOrgId,
  })
  const entries: SharedMemoryEntry[] = memData?.data ?? []

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      setOrgMemory(activeOrgId, key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgMemory', activeOrgId] })
      toast.success('Memory entry saved')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (key: string) => deleteOrgMemory(activeOrgId, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgMemory', activeOrgId] })
      toast.success('Memory entry deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div>
      {orgs.length > 1 && (
        <div className="mb-4">
          <label className="block text-xs text-slate-400 mb-1.5">Organization</label>
          <select
            value={activeOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="w-full max-w-xs bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent-purple"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!activeOrgId ? (
        <EmptyState icon={Building2} message="No organizations found." />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Brain} message="No memory entries for this organization yet." />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <MemoryCard
              key={entry.id}
              entryKey={entry.key}
              value={entry.value}
              updatedAt={entry.updatedAt}
              onSave={(newValue) => saveMutation.mutate({ key: entry.key, value: newValue })}
              onDelete={() => deleteMutation.mutate(entry.key)}
            />
          ))}
        </div>
      )}

      {activeOrgId && (
        <AddEntryForm
          onAdd={(key, value) => saveMutation.mutate({ key, value })}
        />
      )}
    </div>
  )
}

// ─── Agent Memory Tab ────────────────────────────────────────────────────────

function AgentMemoryTab() {
  const qc = useQueryClient()
  const toast = useToast()

  const { data: agentsData } = useQuery({ queryKey: ['agents'], queryFn: () => getAgents() })
  const agents: Agent[] = agentsData?.data ?? []
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')

  const activeAgentId = selectedAgentId || agents[0]?.id || ''

  const { data: memData, isLoading } = useQuery({
    queryKey: ['agentMemory', activeAgentId],
    queryFn: () => getAgentMemory(activeAgentId),
    enabled: !!activeAgentId,
  })
  const entries: AgentMemoryEntry[] = memData?.data ?? []

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      setAgentMemory(activeAgentId, key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentMemory', activeAgentId] })
      toast.success('Memory entry saved')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (key: string) => deleteAgentMemory(activeAgentId, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentMemory', activeAgentId] })
      toast.success('Memory entry deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div>
      {agents.length > 0 && (
        <div className="mb-4">
          <label className="block text-xs text-slate-400 mb-1.5">Agent</label>
          <select
            value={activeAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="w-full max-w-xs bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-accent-purple"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
        </div>
      )}

      {!activeAgentId ? (
        <EmptyState icon={Bot} message="No agents found." />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Brain} message="No memory entries for this agent yet." />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <MemoryCard
              key={entry.id}
              entryKey={entry.key}
              value={entry.value}
              updatedAt={entry.updatedAt}
              onSave={(newValue) => saveMutation.mutate({ key: entry.key, value: newValue })}
              onDelete={() => deleteMutation.mutate(entry.key)}
            />
          ))}
        </div>
      )}

      {activeAgentId && (
        <AddEntryForm
          onAdd={(key, value) => saveMutation.mutate({ key, value })}
        />
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Memory() {
  const [tab, setTab] = useState<Tab>('org')

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-accent-purple/15 rounded-lg">
          <Brain size={22} className="text-accent-purple" />
        </div>
        <h1 className="text-xl font-bold text-white">Memory</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('org')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
            tab === 'org'
              ? 'bg-accent-purple/20 text-accent-purple border-accent-purple/30'
              : 'text-slate-400 border-dark-border hover:text-slate-200 hover:bg-dark-card'
          }`}
        >
          <Building2 size={15} />
          Organization Memory
        </button>
        <button
          type="button"
          onClick={() => setTab('agent')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
            tab === 'agent'
              ? 'bg-accent-purple/20 text-accent-purple border-accent-purple/30'
              : 'text-slate-400 border-dark-border hover:text-slate-200 hover:bg-dark-card'
          }`}
        >
          <Bot size={15} />
          Agent Memory
        </button>
      </div>

      {/* Content */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-5">
        {tab === 'org' ? <OrgMemoryTab /> : <AgentMemoryTab />}
      </div>
    </div>
  )
}
