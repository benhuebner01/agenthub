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

interface SelectedFile {
  type: 'org-memory' | 'agent-memory' | 'agent-system-prompt'
  orgId?: string
  orgName?: string
  agentId?: string
  agentName?: string
  key: string
  value: string
  updatedAt?: string
  readOnly?: boolean
}

// ─── Folder Tree Item ────────────────────────────────────────────────────────

function TreeFolder({
  label,
  icon,
  isOpen,
  onToggle,
  children,
  depth = 0,
}: {
  label: string
  icon?: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children?: React.ReactNode
  depth?: number
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-sm text-slate-300 hover:bg-white/5 rounded transition-colors"
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
      {isOpen && children}
    </div>
  )
}

function TreeFile({
  label,
  isSelected,
  onClick,
  depth = 0,
}: {
  label: string
  isSelected: boolean
  onClick: () => void
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
      <FileText size={13} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
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
}: {
  onAdd: (key: string) => void
  onCancel: () => void
}) {
  const [key, setKey] = useState('')

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <input
        type="text"
        autoFocus
        placeholder="file_name"
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
  }, [file.key, file.agentId, file.orgId, file.type, file.value])

  const breadcrumbParts: string[] = []
  if (file.orgName) breadcrumbParts.push(file.orgName)
  if (file.agentName) breadcrumbParts.push(file.agentName)
  if (file.type === 'org-memory') breadcrumbParts.push('Shared Memory')
  if (file.type === 'agent-memory') breadcrumbParts.push('Memory')
  if (file.type === 'agent-system-prompt') breadcrumbParts.push('System Prompt')
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
        {breadcrumbParts.map((part, i) => (
          <span key={i} className="flex items-center gap-1.5 flex-shrink-0">
            {i > 0 && <span className="text-slate-600">/</span>}
            <span className={i === breadcrumbParts.length - 1 ? 'text-slate-200 font-medium' : ''}>
              {part}
            </span>
          </span>
        ))}
      </div>

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
        Organization shared memory and individual agent memory entries are organized
        as files in a folder structure.
      </p>
      <div className="mt-6 space-y-2 text-xs text-slate-500">
        <p>Click a folder to expand it and see its contents.</p>
        <p>Click the <Plus size={12} className="inline" /> button next to a Memory folder to add a new entry.</p>
      </div>
    </div>
  )
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
  const [addingTo, setAddingTo] = useState<{ type: 'org' | 'agent'; id: string } | null>(null)

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

  // ── Mutations ──
  const saveOrgMem = useMutation({
    mutationFn: ({ orgId, key, value }: { orgId: string; key: string; value: string }) =>
      setOrgMemory(orgId, key, value),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orgMemory-all'] })
      toast.success('Saved')
      // Update selected file value so isDirty resets
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

  // ── Handlers ──
  const handleSave = (value: string) => {
    if (!selectedFile || selectedFile.readOnly) return
    if (selectedFile.type === 'org-memory' && selectedFile.orgId) {
      saveOrgMem.mutate({ orgId: selectedFile.orgId, key: selectedFile.key, value })
    } else if (selectedFile.type === 'agent-memory' && selectedFile.agentId) {
      saveAgentMem.mutate({ agentId: selectedFile.agentId, key: selectedFile.key, value })
    }
  }

  const handleDelete = () => {
    if (!selectedFile || selectedFile.readOnly) return
    if (selectedFile.type === 'org-memory' && selectedFile.orgId) {
      deleteOrgMem.mutate({ orgId: selectedFile.orgId, key: selectedFile.key })
    } else if (selectedFile.type === 'agent-memory' && selectedFile.agentId) {
      deleteAgentMem.mutate({ agentId: selectedFile.agentId, key: selectedFile.key })
    }
  }

  const handleAddFile = (key: string) => {
    if (!addingTo) return
    if (addingTo.type === 'org') {
      saveOrgMem.mutate({ orgId: addingTo.id, key, value: '' })
      // Select the new file
      const org = orgs.find((o) => o.id === addingTo.id)
      setSelectedFile({
        type: 'org-memory',
        orgId: addingTo.id,
        orgName: org?.name,
        key,
        value: '',
      })
    } else {
      saveAgentMem.mutate({ agentId: addingTo.id, key, value: '' })
      const agent = agents.find((a) => a.id === addingTo.id)
      const org = orgs.find((o) => o.id === agent?.organizationId)
      setSelectedFile({
        type: 'agent-memory',
        orgId: org?.id,
        orgName: org?.name,
        agentId: addingTo.id,
        agentName: agent?.name,
        key,
        value: '',
      })
    }
    setAddingTo(null)
  }

  const isFileSelected = (type: string, id: string, key: string) =>
    selectedFile?.type === type &&
    (type === 'org-memory' ? selectedFile.orgId === id : selectedFile.agentId === id) &&
    selectedFile.key === key

  // ── Render tree for a single organization ──
  const renderOrgTree = (org: Organization) => {
    const orgKey = `org-${org.id}`
    const sharedKey = `org-${org.id}-shared`
    const kbKey = `org-${org.id}-kb`
    const orgAgents = agentsByOrg[org.id] || []
    const sharedEntries = orgMemoryMap[org.id] || []

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
        <div className="group/shared relative">
          <div className="flex items-center">
            <div className="flex-1">
              <TreeFolder
                label="Shared Memory"
                isOpen={!!openFolders[sharedKey]}
                onToggle={() => toggleFolder(sharedKey)}
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
                {openFolders[sharedKey] && sharedEntries.length === 0 && !addingTo && (
                  <div
                    className="text-xs text-slate-600 italic px-2 py-1"
                    style={{ paddingLeft: `${2 * 16 + 8}px` }}
                  >
                    (empty)
                  </div>
                )}
                {addingTo?.type === 'org' && addingTo.id === org.id && (
                  <div style={{ paddingLeft: `${2 * 16}px` }}>
                    <AddFileInline onAdd={handleAddFile} onCancel={() => setAddingTo(null)} />
                  </div>
                )}
              </TreeFolder>
            </div>
            {openFolders[sharedKey] && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setAddingTo({ type: 'org', id: org.id })
                }}
                className="opacity-0 group-hover/shared:opacity-100 p-0.5 mr-2 text-slate-500 hover:text-accent-purple transition-all"
                title="Add new entry"
              >
                <Plus size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Knowledge Base placeholder */}
        <TreePlaceholder label="Knowledge Base (coming soon)" depth={1} />

        {/* Agent folders */}
        {orgAgents.map((agent) => renderAgentTree(agent, org))}
      </TreeFolder>
    )
  }

  const renderAgentTree = (agent: Agent, org?: Organization) => {
    const agentKey = `agent-${agent.id}`
    const memKey = `agent-${agent.id}-memory`
    const sysKey = `agent-${agent.id}-system`
    const agentEntries = agentMemoryMap[agent.id] || []
    const systemPrompt = (agent.config?.systemPrompt as string) || ''

    return (
      <TreeFolder
        key={agent.id}
        label={agent.name}
        icon={<Bot size={14} className="text-green-400/80 flex-shrink-0" />}
        isOpen={!!openFolders[agentKey]}
        onToggle={() => toggleFolder(agentKey)}
        depth={org ? 1 : 0}
      >
        {/* Agent Memory folder */}
        <div className="group/amem relative">
          <div className="flex items-center">
            <div className="flex-1">
              <TreeFolder
                label="Memory"
                isOpen={!!openFolders[memKey]}
                onToggle={() => toggleFolder(memKey)}
                depth={org ? 2 : 1}
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
                    depth={org ? 3 : 2}
                  />
                ))}
                {openFolders[memKey] && agentEntries.length === 0 && !addingTo && (
                  <div
                    className="text-xs text-slate-600 italic px-2 py-1"
                    style={{ paddingLeft: `${(org ? 3 : 2) * 16 + 8}px` }}
                  >
                    (empty)
                  </div>
                )}
                {addingTo?.type === 'agent' && addingTo.id === agent.id && (
                  <div style={{ paddingLeft: `${(org ? 3 : 2) * 16}px` }}>
                    <AddFileInline onAdd={handleAddFile} onCancel={() => setAddingTo(null)} />
                  </div>
                )}
              </TreeFolder>
            </div>
            {openFolders[memKey] && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setAddingTo({ type: 'agent', id: agent.id })
                }}
                className="opacity-0 group-hover/amem:opacity-100 p-0.5 mr-2 text-slate-500 hover:text-accent-purple transition-all"
                title="Add new entry"
              >
                <Plus size={13} />
              </button>
            )}
          </div>
        </div>

        {/* System Prompt (read-only file) */}
        <TreeFolder
          label="System Prompt"
          icon={<BookOpen size={14} className="text-orange-400/80 flex-shrink-0" />}
          isOpen={!!openFolders[sysKey]}
          onToggle={() => toggleFolder(sysKey)}
          depth={org ? 2 : 1}
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
              depth={org ? 3 : 2}
            />
          ) : (
            <div
              className="text-xs text-slate-600 italic px-2 py-1"
              style={{ paddingLeft: `${(org ? 3 : 2) * 16 + 8}px` }}
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
        <div className="lg:w-[260px] flex-shrink-0 border border-dark-border rounded-xl bg-dark-card overflow-hidden flex flex-col">
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
