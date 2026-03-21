import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Brain,
  Building2,
  Bot,
  Plus,
  Trash2,
  Save,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  BookOpen,
  X,
  Calendar,
  Lightbulb,
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
  getAgentDailyNotes,
  setAgentDailyNote,
  deleteAgentDailyNote,
  getAgentKnowledge,
  createAgentKnowledge,
  updateAgentKnowledge,
  deleteAgentKnowledge,
  getOrgKnowledge,
  createOrgKnowledge,
  updateOrgKnowledge,
  deleteOrgKnowledge,
  getAgentTacit,
  createAgentTacit,
  updateAgentTacit,
  deleteAgentTacit,
  Organization,
  Agent,
  SharedMemoryEntry,
  AgentMemoryEntry,
  DailyNote,
  KnowledgeEntry,
  TacitEntry,
} from '../api/client'
import { useToast } from '../components/Toaster'

// ─── Types ───────────────────────────────────────────────────────────────────

type FileType = 'org-memory' | 'agent-memory' | 'agent-system-prompt' | 'daily-note' | 'knowledge' | 'tacit' | 'org-knowledge'

interface SelectedFile {
  type: FileType
  orgId?: string
  orgName?: string
  agentId?: string
  agentName?: string
  key: string
  value: string
  updatedAt?: string
  readOnly?: boolean
  // Extra fields for specific types
  entryId?: string
  category?: string
  confidence?: number
}

type AddingToType =
  | { type: 'org'; id: string }
  | { type: 'agent'; id: string }
  | { type: 'daily-note'; agentId: string }
  | { type: 'knowledge'; agentId: string; category: string }
  | { type: 'tacit'; agentId: string }
  | { type: 'org-knowledge'; orgId: string; category: string }

// ─── Folder Tree Item ────────────────────────────────────────────────────────

function TreeFolder({
  label,
  icon,
  isOpen,
  onToggle,
  onAdd,
  children,
  depth = 0,
}: {
  label: string
  icon?: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  onAdd?: () => void
  children?: React.ReactNode
  depth?: number
}) {
  return (
    <div className="group/folder">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-1.5 px-2 py-1 text-left text-sm text-slate-300 hover:bg-white/5 rounded transition-colors"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isOpen ? (
            <ChevronDown size={13} className="text-slate-500 flex-shrink-0" />
          ) : (
            <ChevronRight size={13} className="text-slate-500 flex-shrink-0" />
          )}
          {icon || (isOpen ? (
            <FolderOpen size={14} className="text-yellow-500/80 flex-shrink-0" />
          ) : (
            <Folder size={14} className="text-yellow-500/80 flex-shrink-0" />
          ))}
          <span className="truncate">{label}</span>
        </button>
        {onAdd && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
            className="opacity-0 group-hover/folder:opacity-100 p-0.5 mr-2 text-slate-500 hover:text-accent-purple transition-all"
            title="Add new entry"
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {isOpen && children}
    </div>
  )
}

function TreeFile({
  label,
  icon,
  isSelected,
  onClick,
  badge,
  depth = 0,
}: {
  label: string
  icon?: React.ReactNode
  isSelected: boolean
  onClick: () => void
  badge?: React.ReactNode
  depth?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs rounded transition-colors ${
        isSelected
          ? 'bg-accent-purple/20 text-accent-purple'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      {icon || <FileText size={13} className="flex-shrink-0" />}
      <span className="truncate flex-1">{label}</span>
      {badge}
    </button>
  )
}

function TreePlaceholder({
  label,
  depth = 0,
}: {
  label: string
  depth?: number
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-600 italic"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <Folder size={13} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  )
}

// ─── Add File Dialog ─────────────────────────────────────────────────────────

function AddFileInline({
  onAdd,
  onCancel,
  placeholder = 'file_name',
}: {
  onAdd: (key: string) => void
  onCancel: () => void
  placeholder?: string
}) {
  const [key, setKey] = useState('')

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <input
        type="text"
        autoFocus
        placeholder={placeholder}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && key.trim()) onAdd(key.trim())
          if (e.key === 'Escape') onCancel()
        }}
        className="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-0.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple min-w-0"
      />
      <button
        type="button"
        onClick={() => key.trim() && onAdd(key.trim())}
        className="p-0.5 text-accent-purple hover:text-accent-purple/80"
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-0.5 text-slate-500 hover:text-slate-300"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ─── File Viewer / Editor ────────────────────────────────────────────────────

function FileViewer({
  file,
  onSave,
  onDelete,
}: {
  file: SelectedFile
  onSave: (value: string) => void
  onDelete: () => void
}) {
  const [editValue, setEditValue] = useState(file.value)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isDirty = editValue !== file.value

  // Sync when file changes
  useEffect(() => {
    setEditValue(file.value)
    setConfirmDelete(false)
  }, [file.key, file.agentId, file.orgId, file.type, file.value, file.entryId])

  const breadcrumbParts: string[] = []
  if (file.orgName) breadcrumbParts.push(file.orgName)
  if (file.agentName) breadcrumbParts.push(file.agentName)
  if (file.type === 'org-memory') breadcrumbParts.push('Shared Memory')
  if (file.type === 'agent-memory') breadcrumbParts.push('Memory')
  if (file.type === 'agent-system-prompt') breadcrumbParts.push('System Prompt')
  if (file.type === 'daily-note') breadcrumbParts.push('Daily Notes')
  if (file.type === 'knowledge') breadcrumbParts.push('Knowledge', file.category || '')
  if (file.type === 'org-knowledge') breadcrumbParts.push('Knowledge Base', file.category || '')
  if (file.type === 'tacit') breadcrumbParts.push('Tacit Knowledge')
  breadcrumbParts.push(file.key)

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
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-dark-border text-xs text-slate-400 overflow-x-auto flex-shrink-0">
        {breadcrumbParts.filter(Boolean).map((part, i) => (
          <span key={i} className="flex items-center gap-1.5 flex-shrink-0">
            {i > 0 && <span className="text-slate-600">/</span>}
            <span className={i === breadcrumbParts.filter(Boolean).length - 1 ? 'text-slate-200 font-medium' : ''}>
              {part}
            </span>
          </span>
        ))}
      </div>

      {/* Confidence badge for tacit */}
      {file.type === 'tacit' && file.confidence !== undefined && (
        <div className="px-4 pt-3 flex-shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
            <Lightbulb size={12} />
            Confidence: {Math.round(file.confidence * 100)}%
          </span>
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 p-4 overflow-auto">
        <textarea
          className={`w-full h-full min-h-[300px] bg-dark-bg border border-dark-border rounded-lg px-4 py-3 text-sm text-slate-200 font-mono resize-none focus:outline-none focus:border-accent-purple ${
            file.readOnly ? 'opacity-70 cursor-not-allowed' : ''
          }`}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          readOnly={file.readOnly}
          placeholder={file.readOnly ? '(read-only)' : 'Enter content...'}
        />
      </div>

      {/* Footer bar */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-dark-border flex-shrink-0">
        <div className="text-xs text-slate-500">
          {file.updatedAt && (
            <span>Last updated: {new Date(file.updatedAt).toLocaleString()}</span>
          )}
          {file.readOnly && (
            <span className="ml-2 px-1.5 py-0.5 bg-slate-700/50 rounded text-slate-400">Read-only</span>
          )}
          {isDirty && !file.readOnly && (
            <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 rounded">Unsaved changes</span>
          )}
        </div>
        {!file.readOnly && (
          <div className="flex items-center gap-2">
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
              {confirmDelete ? 'Confirm Delete' : 'Delete'}
            </button>
            <button
              type="button"
              onClick={() => onSave(editValue)}
              disabled={!isDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-accent-purple hover:bg-accent-purple/80 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save size={13} />
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Welcome Screen ──────────────────────────────────────────────────────────

function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="p-4 bg-accent-purple/10 rounded-2xl mb-5">
        <Brain size={36} className="text-accent-purple" />
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">Knowledge & Memory</h2>
      <p className="text-sm text-slate-400 max-w-md leading-relaxed">
        Select a file from the folder tree on the left to view or edit its contents.
        Organization shared memory, knowledge bases, daily notes, and tacit knowledge
        are organized as files in a folder structure.
      </p>
      <div className="mt-6 space-y-2 text-xs text-slate-500">
        <p>Click a folder to expand it and see its contents.</p>
        <p>Hover over a folder and click the <Plus size={12} className="inline" /> button to add a new entry.</p>
      </div>
    </div>
  )
}

// ─── Knowledge category helpers ──────────────────────────────────────────────

const KB_CATEGORIES = ['projects', 'areas', 'resources', 'archives'] as const

function categoryLabel(cat: string) {
  return cat.charAt(0).toUpperCase() + cat.slice(1)
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Memory() {
  const qc = useQueryClient()
  const toast = useToast()

  // ── Data fetching ──
  const { data: orgsData } = useQuery({ queryKey: ['organizations'], queryFn: getOrganizations })
  const orgs: Organization[] = orgsData?.data ?? []

  const { data: agentsData } = useQuery({ queryKey: ['agents'], queryFn: () => getAgents() })
  const agents: Agent[] = agentsData?.data ?? []

  // ── State ──
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const [addingTo, setAddingTo] = useState<AddingToType | null>(null)

  // Group agents by org
  const agentsByOrg = useMemo(() => {
    const map: Record<string, Agent[]> = {}
    for (const a of agents) {
      const orgId = a.organizationId || '_unassigned'
      if (!map[orgId]) map[orgId] = []
      map[orgId].push(a)
    }
    return map
  }, [agents])

  // Auto-open first org folder
  useEffect(() => {
    if (orgs.length > 0 && Object.keys(openFolders).length === 0) {
      setOpenFolders({ [`org-${orgs[0].id}`]: true })
    }
  }, [orgs]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFolder = (key: string) => {
    setOpenFolders((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // ── Org memory queries (fetch for each open org) ──
  const openOrgIds = orgs
    .filter((o) => openFolders[`org-${o.id}-shared`])
    .map((o) => o.id)

  const orgMemoryQueries = useQuery({
    queryKey: ['orgMemory-all', openOrgIds],
    queryFn: async () => {
      const results: Record<string, SharedMemoryEntry[]> = {}
      await Promise.all(
        openOrgIds.map(async (id) => {
          const res = await getOrgMemory(id)
          results[id] = res.data
        })
      )
      return results
    },
    enabled: openOrgIds.length > 0,
  })
  const orgMemoryMap = orgMemoryQueries.data ?? {}

  // ── Agent memory queries (fetch for each open agent) ──
  const openAgentMemoryIds = agents
    .filter((a) => openFolders[`agent-${a.id}-memory`])
    .map((a) => a.id)

  const agentMemoryQueries = useQuery({
    queryKey: ['agentMemory-all', openAgentMemoryIds],
    queryFn: async () => {
      const results: Record<string, AgentMemoryEntry[]> = {}
      await Promise.all(
        openAgentMemoryIds.map(async (id) => {
          const res = await getAgentMemory(id)
          results[id] = res.data
        })
      )
      return results
    },
    enabled: openAgentMemoryIds.length > 0,
  })
  const agentMemoryMap = agentMemoryQueries.data ?? {}

  // ── Daily notes queries ──
  const openDailyNoteAgentIds = agents
    .filter((a) => openFolders[`agent-${a.id}-daily`])
    .map((a) => a.id)

  const dailyNotesQueries = useQuery({
    queryKey: ['dailyNotes-all', openDailyNoteAgentIds],
    queryFn: async () => {
      const results: Record<string, DailyNote[]> = {}
      await Promise.all(
        openDailyNoteAgentIds.map(async (id) => {
          const res = await getAgentDailyNotes(id)
          results[id] = res.data
        })
      )
      return results
    },
    enabled: openDailyNoteAgentIds.length > 0,
  })
  const dailyNotesMap = dailyNotesQueries.data ?? {}

  // ── Agent knowledge queries ──
  const openAgentKbIds = agents
    .filter((a) => openFolders[`agent-${a.id}-kb`])
    .map((a) => a.id)

  const agentKbQueries = useQuery({
    queryKey: ['agentKb-all', openAgentKbIds],
    queryFn: async () => {
      const results: Record<string, KnowledgeEntry[]> = {}
      await Promise.all(
        openAgentKbIds.map(async (id) => {
          const res = await getAgentKnowledge(id)
          results[id] = res.data
        })
      )
      return results
    },
    enabled: openAgentKbIds.length > 0,
  })
  const agentKbMap = agentKbQueries.data ?? {}

  // ── Org knowledge queries ──
  const openOrgKbIds = orgs
    .filter((o) => openFolders[`org-${o.id}-kb`])
    .map((o) => o.id)

  const orgKbQueries = useQuery({
    queryKey: ['orgKb-all', openOrgKbIds],
    queryFn: async () => {
      const results: Record<string, KnowledgeEntry[]> = {}
      await Promise.all(
        openOrgKbIds.map(async (id) => {
          const res = await getOrgKnowledge(id)
          results[id] = res.data
        })
      )
      return results
    },
    enabled: openOrgKbIds.length > 0,
  })
  const orgKbMap = orgKbQueries.data ?? {}

  // ── Tacit knowledge queries ──
  const openTacitAgentIds = agents
    .filter((a) => openFolders[`agent-${a.id}-tacit`])
    .map((a) => a.id)

  const tacitQueries = useQuery({
    queryKey: ['tacit-all', openTacitAgentIds],
    queryFn: async () => {
      const results: Record<string, TacitEntry[]> = {}
      await Promise.all(
        openTacitAgentIds.map(async (id) => {
          const res = await getAgentTacit(id)
          results[id] = res.data
        })
      )
      return results
    },
    enabled: openTacitAgentIds.length > 0,
  })
  const tacitMap = tacitQueries.data ?? {}

  // ── Mutations: Org Memory ──
  const saveOrgMem = useMutation({
    mutationFn: ({ orgId, key, value }: { orgId: string; key: string; value: string }) =>
      setOrgMemory(orgId, key, value),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orgMemory-all'] })
      toast.success('Saved')
      setSelectedFile((prev) =>
        prev && prev.type === 'org-memory' && prev.orgId === vars.orgId && prev.key === vars.key
          ? { ...prev, value: vars.value }
          : prev
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteOrgMem = useMutation({
    mutationFn: ({ orgId, key }: { orgId: string; key: string }) =>
      deleteOrgMemory(orgId, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgMemory-all'] })
      toast.success('Deleted')
      setSelectedFile(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── Mutations: Agent Memory ──
  const saveAgentMem = useMutation({
    mutationFn: ({ agentId, key, value }: { agentId: string; key: string; value: string }) =>
      setAgentMemory(agentId, key, value),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['agentMemory-all'] })
      toast.success('Saved')
      setSelectedFile((prev) =>
        prev && prev.type === 'agent-memory' && prev.agentId === vars.agentId && prev.key === vars.key
          ? { ...prev, value: vars.value }
          : prev
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteAgentMem = useMutation({
    mutationFn: ({ agentId, key }: { agentId: string; key: string }) =>
      deleteAgentMemory(agentId, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentMemory-all'] })
      toast.success('Deleted')
      setSelectedFile(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── Mutations: Daily Notes ──
  const saveDailyNote = useMutation({
    mutationFn: ({ agentId, date, content }: { agentId: string; date: string; content: string }) =>
      setAgentDailyNote(agentId, date, content),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['dailyNotes-all'] })
      toast.success('Saved')
      setSelectedFile((prev) =>
        prev && prev.type === 'daily-note' && prev.agentId === vars.agentId && prev.key === vars.date
          ? { ...prev, value: vars.content }
          : prev
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteDailyNote = useMutation({
    mutationFn: ({ agentId, date }: { agentId: string; date: string }) =>
      deleteAgentDailyNote(agentId, date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dailyNotes-all'] })
      toast.success('Deleted')
      setSelectedFile(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── Mutations: Agent Knowledge ──
  const saveAgentKb = useMutation({
    mutationFn: ({ agentId, entryId, data }: { agentId: string; entryId?: string; data: { category: string; title: string; content: string } }) =>
      entryId ? updateAgentKnowledge(agentId, entryId, data) : createAgentKnowledge(agentId, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['agentKb-all'] })
      toast.success('Saved')
      if (vars.entryId) {
        setSelectedFile((prev) =>
          prev && prev.type === 'knowledge' && prev.entryId === vars.entryId
            ? { ...prev, value: vars.data.content }
            : prev
        )
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteAgentKb = useMutation({
    mutationFn: ({ agentId, entryId }: { agentId: string; entryId: string }) =>
      deleteAgentKnowledge(agentId, entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agentKb-all'] })
      toast.success('Deleted')
      setSelectedFile(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── Mutations: Org Knowledge ──
  const saveOrgKb = useMutation({
    mutationFn: ({ orgId, entryId, data }: { orgId: string; entryId?: string; data: { category: string; title: string; content: string } }) =>
      entryId ? updateOrgKnowledge(orgId, entryId, data) : createOrgKnowledge(orgId, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orgKb-all'] })
      toast.success('Saved')
      if (vars.entryId) {
        setSelectedFile((prev) =>
          prev && prev.type === 'org-knowledge' && prev.entryId === vars.entryId
            ? { ...prev, value: vars.data.content }
            : prev
        )
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteOrgKb = useMutation({
    mutationFn: ({ orgId, entryId }: { orgId: string; entryId: string }) =>
      deleteOrgKnowledge(orgId, entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgKb-all'] })
      toast.success('Deleted')
      setSelectedFile(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── Mutations: Tacit Knowledge ──
  const saveTacit = useMutation({
    mutationFn: ({ agentId, entryId, data }: { agentId: string; entryId?: string; data: { topic: string; insight: string; confidence?: number } }) =>
      entryId ? updateAgentTacit(agentId, entryId, data) : createAgentTacit(agentId, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['tacit-all'] })
      toast.success('Saved')
      if (vars.entryId) {
        setSelectedFile((prev) =>
          prev && prev.type === 'tacit' && prev.entryId === vars.entryId
            ? { ...prev, value: vars.data.insight }
            : prev
        )
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteTacit = useMutation({
    mutationFn: ({ agentId, entryId }: { agentId: string; entryId: string }) =>
      deleteAgentTacit(agentId, entryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tacit-all'] })
      toast.success('Deleted')
      setSelectedFile(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  // ── Handlers ──
  const handleSave = (value: string) => {
    if (!selectedFile || selectedFile.readOnly) return

    switch (selectedFile.type) {
      case 'org-memory':
        if (selectedFile.orgId) saveOrgMem.mutate({ orgId: selectedFile.orgId, key: selectedFile.key, value })
        break
      case 'agent-memory':
        if (selectedFile.agentId) saveAgentMem.mutate({ agentId: selectedFile.agentId, key: selectedFile.key, value })
        break
      case 'daily-note':
        if (selectedFile.agentId) saveDailyNote.mutate({ agentId: selectedFile.agentId, date: selectedFile.key, content: value })
        break
      case 'knowledge':
        if (selectedFile.agentId && selectedFile.category) {
          saveAgentKb.mutate({
            agentId: selectedFile.agentId,
            entryId: selectedFile.entryId,
            data: { category: selectedFile.category, title: selectedFile.key, content: value },
          })
        }
        break
      case 'org-knowledge':
        if (selectedFile.orgId && selectedFile.category) {
          saveOrgKb.mutate({
            orgId: selectedFile.orgId,
            entryId: selectedFile.entryId,
            data: { category: selectedFile.category, title: selectedFile.key, content: value },
          })
        }
        break
      case 'tacit':
        if (selectedFile.agentId) {
          saveTacit.mutate({
            agentId: selectedFile.agentId,
            entryId: selectedFile.entryId,
            data: { topic: selectedFile.key, insight: value, confidence: selectedFile.confidence },
          })
        }
        break
    }
  }

  const handleDelete = () => {
    if (!selectedFile || selectedFile.readOnly) return

    switch (selectedFile.type) {
      case 'org-memory':
        if (selectedFile.orgId) deleteOrgMem.mutate({ orgId: selectedFile.orgId, key: selectedFile.key })
        break
      case 'agent-memory':
        if (selectedFile.agentId) deleteAgentMem.mutate({ agentId: selectedFile.agentId, key: selectedFile.key })
        break
      case 'daily-note':
        if (selectedFile.agentId) deleteDailyNote.mutate({ agentId: selectedFile.agentId, date: selectedFile.key })
        break
      case 'knowledge':
        if (selectedFile.agentId && selectedFile.entryId) deleteAgentKb.mutate({ agentId: selectedFile.agentId, entryId: selectedFile.entryId })
        break
      case 'org-knowledge':
        if (selectedFile.orgId && selectedFile.entryId) deleteOrgKb.mutate({ orgId: selectedFile.orgId, entryId: selectedFile.entryId })
        break
      case 'tacit':
        if (selectedFile.agentId && selectedFile.entryId) deleteTacit.mutate({ agentId: selectedFile.agentId, entryId: selectedFile.entryId })
        break
    }
  }

  const handleAddFile = (key: string) => {
    if (!addingTo) return

    switch (addingTo.type) {
      case 'org': {
        saveOrgMem.mutate({ orgId: addingTo.id, key, value: '' })
        const org = orgs.find((o) => o.id === addingTo.id)
        setSelectedFile({ type: 'org-memory', orgId: addingTo.id, orgName: org?.name, key, value: '' })
        break
      }
      case 'agent': {
        saveAgentMem.mutate({ agentId: addingTo.id, key, value: '' })
        const agent = agents.find((a) => a.id === addingTo.id)
        const org = orgs.find((o) => o.id === agent?.organizationId)
        setSelectedFile({ type: 'agent-memory', orgId: org?.id, orgName: org?.name, agentId: addingTo.id, agentName: agent?.name, key, value: '' })
        break
      }
      case 'daily-note': {
        saveDailyNote.mutate({ agentId: addingTo.agentId, date: key, content: '' })
        const agent = agents.find((a) => a.id === addingTo.agentId)
        const org = orgs.find((o) => o.id === agent?.organizationId)
        setSelectedFile({ type: 'daily-note', orgId: org?.id, orgName: org?.name, agentId: addingTo.agentId, agentName: agent?.name, key, value: '' })
        break
      }
      case 'knowledge': {
        saveAgentKb.mutate({ agentId: addingTo.agentId, data: { category: addingTo.category, title: key, content: '' } })
        const agent = agents.find((a) => a.id === addingTo.agentId)
        const org = orgs.find((o) => o.id === agent?.organizationId)
        setSelectedFile({ type: 'knowledge', orgId: org?.id, orgName: org?.name, agentId: addingTo.agentId, agentName: agent?.name, key, value: '', category: addingTo.category })
        break
      }
      case 'org-knowledge': {
        saveOrgKb.mutate({ orgId: addingTo.orgId, data: { category: addingTo.category, title: key, content: '' } })
        const org = orgs.find((o) => o.id === addingTo.orgId)
        setSelectedFile({ type: 'org-knowledge', orgId: addingTo.orgId, orgName: org?.name, key, value: '', category: addingTo.category })
        break
      }
      case 'tacit': {
        saveTacit.mutate({ agentId: addingTo.agentId, data: { topic: key, insight: '', confidence: 0.5 } })
        const agent = agents.find((a) => a.id === addingTo.agentId)
        const org = orgs.find((o) => o.id === agent?.organizationId)
        setSelectedFile({ type: 'tacit', orgId: org?.id, orgName: org?.name, agentId: addingTo.agentId, agentName: agent?.name, key, value: '', confidence: 0.5 })
        break
      }
    }
    setAddingTo(null)
  }

  const isFileSelected = (type: string, id: string, key: string, entryId?: string) => {
    if (entryId && selectedFile?.entryId) return selectedFile.entryId === entryId
    return (
      selectedFile?.type === type &&
      (type === 'org-memory' || type === 'org-knowledge' ? selectedFile.orgId === id : selectedFile.agentId === id) &&
      selectedFile.key === key
    )
  }

  // ── Render Knowledge subfolder (for both org and agent) ──
  const renderKbCategory = (
    category: string,
    entries: KnowledgeEntry[],
    folderKey: string,
    depth: number,
    fileType: 'knowledge' | 'org-knowledge',
    ownerId: string,
    ownerName?: string,
    orgId?: string,
    orgName?: string,
  ) => {
    const catEntries = entries.filter((e) => e.category === category)
    const isOrgKb = fileType === 'org-knowledge'
    const addType = isOrgKb ? 'org-knowledge' : 'knowledge'

    return (
      <TreeFolder
        key={category}
        label={categoryLabel(category)}
        isOpen={!!openFolders[folderKey]}
        onToggle={() => toggleFolder(folderKey)}
        onAdd={() => {
          if (isOrgKb) {
            setAddingTo({ type: 'org-knowledge', orgId: ownerId, category })
          } else {
            setAddingTo({ type: 'knowledge', agentId: ownerId, category })
          }
        }}
        depth={depth}
      >
        {catEntries.map((entry) => (
          <TreeFile
            key={entry.id}
            label={entry.title}
            icon={<BookOpen size={13} className="text-blue-400/70 flex-shrink-0" />}
            isSelected={isFileSelected(fileType, ownerId, entry.title, entry.id)}
            onClick={() =>
              setSelectedFile({
                type: fileType,
                orgId: isOrgKb ? ownerId : orgId,
                orgName: isOrgKb ? ownerName : orgName,
                agentId: isOrgKb ? undefined : ownerId,
                agentName: isOrgKb ? undefined : ownerName,
                key: entry.title,
                value: entry.content,
                updatedAt: entry.updatedAt,
                entryId: entry.id,
                category,
              })
            }
            depth={depth + 1}
          />
        ))}
        {openFolders[folderKey] && catEntries.length === 0 && !(addingTo && 'category' in addingTo && addingTo.category === category) && (
          <div className="text-xs text-slate-600 italic px-2 py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            (empty)
          </div>
        )}
        {addingTo &&
          addingTo.type === addType &&
          'category' in addingTo &&
          addingTo.category === category &&
          ((isOrgKb && 'orgId' in addingTo && addingTo.orgId === ownerId) ||
           (!isOrgKb && 'agentId' in addingTo && addingTo.agentId === ownerId)) && (
          <div style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
            <AddFileInline onAdd={handleAddFile} onCancel={() => setAddingTo(null)} placeholder="entry_title" />
          </div>
        )}
      </TreeFolder>
    )
  }

  // ── Render tree for a single organization ──
  const renderOrgTree = (org: Organization) => {
    const orgKey = `org-${org.id}`
    const sharedKey = `org-${org.id}-shared`
    const kbKey = `org-${org.id}-kb`
    const orgAgents = agentsByOrg[org.id] || []
    const sharedEntries = orgMemoryMap[org.id] || []
    const orgKbEntries = orgKbMap[org.id] || []

    return (
      <TreeFolder
        key={org.id}
        label={org.name}
        icon={<Building2 size={14} className="text-blue-400/80 flex-shrink-0" />}
        isOpen={!!openFolders[orgKey]}
        onToggle={() => toggleFolder(orgKey)}
        depth={0}
      >
        {/* Shared Memory folder */}
        <TreeFolder
          label="Shared Memory"
          isOpen={!!openFolders[sharedKey]}
          onToggle={() => toggleFolder(sharedKey)}
          onAdd={() => setAddingTo({ type: 'org', id: org.id })}
          depth={1}
        >
          {sharedEntries.map((entry) => (
            <TreeFile
              key={entry.id}
              label={entry.key}
              isSelected={isFileSelected('org-memory', org.id, entry.key)}
              onClick={() =>
                setSelectedFile({
                  type: 'org-memory',
                  orgId: org.id,
                  orgName: org.name,
                  key: entry.key,
                  value: entry.value,
                  updatedAt: entry.updatedAt,
                })
              }
              depth={2}
            />
          ))}
          {openFolders[sharedKey] && sharedEntries.length === 0 && !(addingTo?.type === 'org' && addingTo.id === org.id) && (
            <div className="text-xs text-slate-600 italic px-2 py-1" style={{ paddingLeft: `${2 * 16 + 8}px` }}>
              (empty)
            </div>
          )}
          {addingTo?.type === 'org' && addingTo.id === org.id && (
            <div style={{ paddingLeft: `${2 * 16}px` }}>
              <AddFileInline onAdd={handleAddFile} onCancel={() => setAddingTo(null)} />
            </div>
          )}
        </TreeFolder>

        {/* Knowledge Base folder */}
        <TreeFolder
          label="Knowledge Base"
          icon={<BookOpen size={14} className="text-blue-400/80 flex-shrink-0" />}
          isOpen={!!openFolders[kbKey]}
          onToggle={() => toggleFolder(kbKey)}
          depth={1}
        >
          {KB_CATEGORIES.map((cat) =>
            renderKbCategory(
              cat,
              orgKbEntries,
              `org-${org.id}-kb-${cat}`,
              2,
              'org-knowledge',
              org.id,
              org.name,
            )
          )}
        </TreeFolder>

        {/* Agent folders */}
        {orgAgents.map((agent) => renderAgentTree(agent, org))}
      </TreeFolder>
    )
  }

  const renderAgentTree = (agent: Agent, org?: Organization) => {
    const agentKey = `agent-${agent.id}`
    const memKey = `agent-${agent.id}-memory`
    const dailyKey = `agent-${agent.id}-daily`
    const kbKey = `agent-${agent.id}-kb`
    const tacitKey = `agent-${agent.id}-tacit`
    const sysKey = `agent-${agent.id}-system`

    const agentEntries = agentMemoryMap[agent.id] || []
    const dailyNotes = dailyNotesMap[agent.id] || []
    const kbEntries = agentKbMap[agent.id] || []
    const tacitEntries = tacitMap[agent.id] || []
    const systemPrompt = (agent.config?.systemPrompt as string) || ''

    const baseDepth = org ? 1 : 0

    return (
      <TreeFolder
        key={agent.id}
        label={agent.name}
        icon={<Bot size={14} className="text-green-400/80 flex-shrink-0" />}
        isOpen={!!openFolders[agentKey]}
        onToggle={() => toggleFolder(agentKey)}
        depth={baseDepth}
      >
        {/* Agent Memory folder */}
        <TreeFolder
          label="Memory"
          icon={<Brain size={14} className="text-purple-400/80 flex-shrink-0" />}
          isOpen={!!openFolders[memKey]}
          onToggle={() => toggleFolder(memKey)}
          onAdd={() => setAddingTo({ type: 'agent', id: agent.id })}
          depth={baseDepth + 1}
        >
          {agentEntries.map((entry) => (
            <TreeFile
              key={entry.id}
              label={entry.key}
              isSelected={isFileSelected('agent-memory', agent.id, entry.key)}
              onClick={() =>
                setSelectedFile({
                  type: 'agent-memory',
                  orgId: org?.id,
                  orgName: org?.name,
                  agentId: agent.id,
                  agentName: agent.name,
                  key: entry.key,
                  value: entry.value,
                  updatedAt: entry.updatedAt,
                })
              }
              depth={baseDepth + 2}
            />
          ))}
          {openFolders[memKey] && agentEntries.length === 0 && !(addingTo?.type === 'agent' && addingTo.id === agent.id) && (
            <div className="text-xs text-slate-600 italic px-2 py-1" style={{ paddingLeft: `${(baseDepth + 2) * 16 + 8}px` }}>
              (empty)
            </div>
          )}
          {addingTo?.type === 'agent' && addingTo.id === agent.id && (
            <div style={{ paddingLeft: `${(baseDepth + 2) * 16}px` }}>
              <AddFileInline onAdd={handleAddFile} onCancel={() => setAddingTo(null)} />
            </div>
          )}
        </TreeFolder>

        {/* Daily Notes folder */}
        <TreeFolder
          label="Daily Notes"
          icon={<Calendar size={14} className="text-cyan-400/80 flex-shrink-0" />}
          isOpen={!!openFolders[dailyKey]}
          onToggle={() => toggleFolder(dailyKey)}
          onAdd={() => setAddingTo({ type: 'daily-note', agentId: agent.id })}
          depth={baseDepth + 1}
        >
          {dailyNotes
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((note) => (
              <TreeFile
                key={note.id}
                label={note.date}
                icon={<Calendar size={13} className="text-cyan-400/70 flex-shrink-0" />}
                isSelected={isFileSelected('daily-note', agent.id, note.date, note.id)}
                onClick={() =>
                  setSelectedFile({
                    type: 'daily-note',
                    orgId: org?.id,
                    orgName: org?.name,
                    agentId: agent.id,
                    agentName: agent.name,
                    key: note.date,
                    value: note.content,
                    updatedAt: note.updatedAt,
                    entryId: note.id,
                  })
                }
                depth={baseDepth + 2}
              />
            ))}
          {openFolders[dailyKey] && dailyNotes.length === 0 && !(addingTo?.type === 'daily-note' && addingTo.agentId === agent.id) && (
            <div className="text-xs text-slate-600 italic px-2 py-1" style={{ paddingLeft: `${(baseDepth + 2) * 16 + 8}px` }}>
              (empty)
            </div>
          )}
          {addingTo?.type === 'daily-note' && addingTo.agentId === agent.id && (
            <div style={{ paddingLeft: `${(baseDepth + 2) * 16}px` }}>
              <AddFileInline onAdd={handleAddFile} onCancel={() => setAddingTo(null)} placeholder="YYYY-MM-DD" />
            </div>
          )}
        </TreeFolder>

        {/* Knowledge folder */}
        <TreeFolder
          label="Knowledge"
          icon={<BookOpen size={14} className="text-blue-400/80 flex-shrink-0" />}
          isOpen={!!openFolders[kbKey]}
          onToggle={() => toggleFolder(kbKey)}
          depth={baseDepth + 1}
        >
          {KB_CATEGORIES.map((cat) =>
            renderKbCategory(
              cat,
              kbEntries,
              `agent-${agent.id}-kb-${cat}`,
              baseDepth + 2,
              'knowledge',
              agent.id,
              agent.name,
              org?.id,
              org?.name,
            )
          )}
        </TreeFolder>

        {/* Tacit Knowledge folder */}
        <TreeFolder
          label="Tacit Knowledge"
          icon={<Lightbulb size={14} className="text-yellow-400/80 flex-shrink-0" />}
          isOpen={!!openFolders[tacitKey]}
          onToggle={() => toggleFolder(tacitKey)}
          onAdd={() => setAddingTo({ type: 'tacit', agentId: agent.id })}
          depth={baseDepth + 1}
        >
          {tacitEntries.map((entry) => (
            <TreeFile
              key={entry.id}
              label={entry.topic}
              icon={<Lightbulb size={13} className="text-yellow-400/70 flex-shrink-0" />}
              isSelected={isFileSelected('tacit', agent.id, entry.topic, entry.id)}
              badge={
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 flex-shrink-0">
                  {Math.round(entry.confidence * 100)}%
                </span>
              }
              onClick={() =>
                setSelectedFile({
                  type: 'tacit',
                  orgId: org?.id,
                  orgName: org?.name,
                  agentId: agent.id,
                  agentName: agent.name,
                  key: entry.topic,
                  value: entry.insight,
                  updatedAt: entry.updatedAt,
                  entryId: entry.id,
                  confidence: entry.confidence,
                })
              }
              depth={baseDepth + 2}
            />
          ))}
          {openFolders[tacitKey] && tacitEntries.length === 0 && !(addingTo?.type === 'tacit' && addingTo.agentId === agent.id) && (
            <div className="text-xs text-slate-600 italic px-2 py-1" style={{ paddingLeft: `${(baseDepth + 2) * 16 + 8}px` }}>
              (empty)
            </div>
          )}
          {addingTo?.type === 'tacit' && addingTo.agentId === agent.id && (
            <div style={{ paddingLeft: `${(baseDepth + 2) * 16}px` }}>
              <AddFileInline onAdd={handleAddFile} onCancel={() => setAddingTo(null)} placeholder="topic_name" />
            </div>
          )}
        </TreeFolder>

        {/* System Prompt (read-only file) */}
        <TreeFolder
          label="System Prompt"
          icon={<BookOpen size={14} className="text-orange-400/80 flex-shrink-0" />}
          isOpen={!!openFolders[sysKey]}
          onToggle={() => toggleFolder(sysKey)}
          depth={baseDepth + 1}
        >
          {systemPrompt ? (
            <TreeFile
              label="systemPrompt"
              isSelected={isFileSelected('agent-system-prompt', agent.id, 'systemPrompt')}
              onClick={() =>
                setSelectedFile({
                  type: 'agent-system-prompt',
                  orgId: org?.id,
                  orgName: org?.name,
                  agentId: agent.id,
                  agentName: agent.name,
                  key: 'systemPrompt',
                  value: systemPrompt,
                  readOnly: true,
                })
              }
              depth={baseDepth + 2}
            />
          ) : (
            <div
              className="text-xs text-slate-600 italic px-2 py-1"
              style={{ paddingLeft: `${(baseDepth + 2) * 16 + 8}px` }}
            >
              (not configured)
            </div>
          )}
        </TreeFolder>
      </TreeFolder>
    )
  }

  // Unassigned agents (no org)
  const unassignedAgents = agentsByOrg['_unassigned'] || []

  return (
    <div className="p-4 lg:p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <div className="p-2 bg-accent-purple/15 rounded-lg">
          <Brain size={22} className="text-accent-purple" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Knowledge & Memory</h1>
          <p className="text-xs text-slate-500">Browse and edit organization and agent memory files</p>
        </div>
      </div>

      {/* Main layout: tree + viewer */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0">
        {/* Left Panel: Folder Tree */}
        <div className="lg:w-[280px] flex-shrink-0 border border-dark-border rounded-xl bg-dark-card overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-dark-border flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Explorer</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {orgs.length === 0 && agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-600">
                <Folder size={28} strokeWidth={1.2} className="mb-2" />
                <p className="text-xs">No organizations or agents found.</p>
              </div>
            ) : (
              <>
                {orgs.map(renderOrgTree)}
                {unassignedAgents.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-dark-border">
                    <div className="px-2 py-1 text-xs text-slate-500 font-medium">Unassigned Agents</div>
                    {unassignedAgents.map((agent) => renderAgentTree(agent))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Panel: File Viewer */}
        <div className="flex-1 border border-dark-border rounded-xl bg-dark-card overflow-hidden min-h-[400px] lg:min-h-0">
          {selectedFile ? (
            <FileViewer
              file={selectedFile}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ) : (
            <WelcomeScreen />
          )}
        </div>
      </div>
    </div>
  )
}
