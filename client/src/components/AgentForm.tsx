import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createAgent, updateAgent, Agent, CreateAgentDto } from '../api/client'
import { useToast } from './Toaster'

interface AgentFormProps {
  agent?: Agent
  onClose: () => void
}

type AgentType = 'http' | 'claude' | 'openai' | 'bash'

const INPUT_CLASS =
  'w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors'

const LABEL_CLASS = 'block text-xs font-medium text-slate-400 mb-1.5'

export default function AgentForm({ agent, onClose }: AgentFormProps) {
  const qc = useQueryClient()
  const toast = useToast()

  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [type, setType] = useState<AgentType>(agent?.type ?? 'claude')
  const [config, setConfig] = useState<Record<string, unknown>>(agent?.config ?? {})

  // HTTP config
  const [httpEndpoint, setHttpEndpoint] = useState<string>(
    (agent?.config?.endpoint as string) ?? ''
  )
  const [httpHeaders, setHttpHeaders] = useState<string>(
    agent?.config?.headers ? JSON.stringify(agent.config.headers, null, 2) : '{}'
  )

  // Claude config
  const [claudeModel, setClaudeModel] = useState<string>(
    (agent?.config?.model as string) ?? 'claude-sonnet-4-5'
  )
  const [claudeSystemPrompt, setClaudeSystemPrompt] = useState<string>(
    (agent?.config?.systemPrompt as string) ?? ''
  )
  const [claudeApiKey, setClaudeApiKey] = useState<string>(
    (agent?.config?.apiKey as string) ?? ''
  )

  // OpenAI config
  const [openaiModel, setOpenaiModel] = useState<string>(
    (agent?.config?.model as string) ?? 'gpt-4o'
  )
  const [openaiSystemPrompt, setOpenaiSystemPrompt] = useState<string>(
    (agent?.config?.systemPrompt as string) ?? ''
  )
  const [openaiApiKey, setOpenaiApiKey] = useState<string>(
    (agent?.config?.apiKey as string) ?? ''
  )

  // Bash config
  const [bashCommand, setBashCommand] = useState<string>(
    (agent?.config?.command as string) ?? ''
  )
  const [bashTimeout, setBashTimeout] = useState<string>(
    String((agent?.config?.timeoutMs as number) ?? 30000)
  )

  const buildConfig = (): Record<string, unknown> => {
    switch (type) {
      case 'http': {
        let headers = {}
        try {
          headers = JSON.parse(httpHeaders)
        } catch {
          // ignore
        }
        return { endpoint: httpEndpoint, headers }
      }
      case 'claude': {
        const cfg: Record<string, unknown> = {
          model: claudeModel,
          systemPrompt: claudeSystemPrompt,
        }
        if (claudeApiKey) cfg.apiKey = claudeApiKey
        return cfg
      }
      case 'openai': {
        const cfg: Record<string, unknown> = {
          model: openaiModel,
          systemPrompt: openaiSystemPrompt,
        }
        if (openaiApiKey) cfg.apiKey = openaiApiKey
        return cfg
      }
      case 'bash':
        return { command: bashCommand, timeoutMs: parseInt(bashTimeout, 10) || 30000 }
      default:
        return config
    }
  }

  const createMutation = useMutation({
    mutationFn: (data: CreateAgentDto) => createAgent(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent created successfully')
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateAgentDto>) => updateAgent(agent!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent updated successfully')
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    const payload: CreateAgentDto = {
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      config: buildConfig(),
    }
    if (agent) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className={LABEL_CLASS}>Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Agent"
          className={INPUT_CLASS}
          required
        />
      </div>

      {/* Description */}
      <div>
        <label className={LABEL_CLASS}>Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this agent does..."
          className={INPUT_CLASS}
        />
      </div>

      {/* Type */}
      <div>
        <label className={LABEL_CLASS}>Type *</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AgentType)}
          className={INPUT_CLASS}
        >
          <option value="claude">Claude (Anthropic)</option>
          <option value="openai">OpenAI</option>
          <option value="http">HTTP Webhook</option>
          <option value="bash">Bash Script</option>
        </select>
      </div>

      {/* Type-specific config */}
      {type === 'http' && (
        <>
          <div>
            <label className={LABEL_CLASS}>Endpoint URL *</label>
            <input
              type="url"
              value={httpEndpoint}
              onChange={(e) => setHttpEndpoint(e.target.value)}
              placeholder="https://example.com/webhook"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Headers (JSON)</label>
            <textarea
              value={httpHeaders}
              onChange={(e) => setHttpHeaders(e.target.value)}
              rows={3}
              className={INPUT_CLASS + ' font-mono text-xs resize-y'}
              placeholder='{"Authorization": "Bearer token"}'
            />
          </div>
        </>
      )}

      {type === 'claude' && (
        <>
          <div>
            <label className={LABEL_CLASS}>Model</label>
            <select
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="claude-opus-4-5">claude-opus-4-5</option>
              <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
              <option value="claude-3-5-haiku-20241022">claude-3-5-haiku</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>System Prompt</label>
            <textarea
              value={claudeSystemPrompt}
              onChange={(e) => setClaudeSystemPrompt(e.target.value)}
              rows={4}
              className={INPUT_CLASS + ' resize-y'}
              placeholder="You are a helpful assistant..."
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>API Key Override (optional)</label>
            <input
              type="password"
              value={claudeApiKey}
              onChange={(e) => setClaudeApiKey(e.target.value)}
              placeholder="sk-ant-... (uses env var if empty)"
              className={INPUT_CLASS}
            />
          </div>
        </>
      )}

      {type === 'openai' && (
        <>
          <div>
            <label className={LABEL_CLASS}>Model</label>
            <select
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>System Prompt</label>
            <textarea
              value={openaiSystemPrompt}
              onChange={(e) => setOpenaiSystemPrompt(e.target.value)}
              rows={4}
              className={INPUT_CLASS + ' resize-y'}
              placeholder="You are a helpful assistant..."
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>API Key Override (optional)</label>
            <input
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder="sk-... (uses env var if empty)"
              className={INPUT_CLASS}
            />
          </div>
        </>
      )}

      {type === 'bash' && (
        <>
          <div>
            <label className={LABEL_CLASS}>Command *</label>
            <input
              type="text"
              value={bashCommand}
              onChange={(e) => setBashCommand(e.target.value)}
              placeholder="echo 'Hello World'"
              className={INPUT_CLASS + ' font-mono text-xs'}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Timeout (ms)</label>
            <input
              type="number"
              value={bashTimeout}
              onChange={(e) => setBashTimeout(e.target.value)}
              min={1000}
              max={300000}
              className={INPUT_CLASS}
            />
          </div>
        </>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? 'Saving...' : agent ? 'Update Agent' : 'Create Agent'}
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
