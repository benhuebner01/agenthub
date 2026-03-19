import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { chatWithInternalAgent } from '../api/client'
import { MessageCircle, X, Send, Loader2, ChevronDown } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  provider?: 'anthropic' | 'openai'
  timestamp: Date
}

// ─── Starter Suggestions ──────────────────────────────────────────────────────

const STARTERS = [
  'How do I set up Claude Code?',
  'What agent type should I use for webhooks?',
  'How do I connect OpenClaw?',
]

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }}
        />
      ))}
    </div>
  )
}

// ─── Provider Badge ───────────────────────────────────────────────────────────

function ProviderBadge({ provider }: { provider?: 'anthropic' | 'openai' }) {
  if (!provider) return null
  return (
    <span
      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium ml-1 ${
        provider === 'anthropic'
          ? 'bg-orange-500/20 text-orange-300'
          : 'bg-green-500/20 text-green-300'
      }`}
    >
      {provider === 'anthropic' ? '🤖 Claude' : '⚡ GPT'}
    </span>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center text-xs shrink-0 mr-2 mt-0.5">
          🎯
        </div>
      )}
      <div className={`max-w-[85%] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-accent-purple text-white rounded-br-md'
              : 'bg-dark-bg border border-dark-border text-slate-200 rounded-bl-md'
          }`}
        >
          {msg.content}
        </div>
        {!isUser && msg.provider && (
          <div className="mt-0.5 pl-1">
            <ProviderBadge provider={msg.provider} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Chat Widget ─────────────────────────────────────────────────────────

export default function InternalAgentChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [unread, setUnread] = useState(0)
  const [isTyping, setIsTyping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isTyping])

  // Focus input when chat opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
    if (open) {
      setUnread(0)
    }
  }, [open])

  const chatMutation = useMutation({
    mutationFn: (message: string) => {
      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      return chatWithInternalAgent(message, history)
    },
    onMutate: (message: string) => {
      // Add user message immediately
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])
      setInput('')
      setIsTyping(true)
    },
    onSuccess: (data) => {
      setIsTyping(false)
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message,
        provider: data.provider,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      if (!open) {
        setUnread((n) => n + 1)
      }
    },
    onError: () => {
      setIsTyping(false)
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I could not get a response. Please check that an AI API key is configured in your settings.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errMsg])
    },
  })

  const handleSend = () => {
    const text = input.trim()
    if (!text || chatMutation.isPending) return
    chatMutation.mutate(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStarter = (text: string) => {
    if (chatMutation.isPending) return
    chatMutation.mutate(text)
  }

  const isEmpty = messages.length === 0

  return (
    <>
      {/* Chat window */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[380px] h-[480px] flex flex-col bg-dark-card border border-dark-border rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-border bg-gradient-to-r from-accent-purple/20 to-accent-blue/10 shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center text-sm">
              🎯
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">AgentHub Assistant</p>
              <p className="text-xs text-slate-500 truncate">
                Ask me about setup, agents & troubleshooting
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
            {isEmpty && !isTyping && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center text-xl shadow-lg shadow-accent-purple/30">
                  🎯
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200 mb-1">
                    I'm your AgentHub assistant
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Ask me anything about setting up agents, understanding the platform, or
                    troubleshooting issues.
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStarter(s)}
                      className="px-3 py-2 text-xs text-left text-slate-300 bg-dark-bg hover:bg-white/5 border border-dark-border hover:border-accent-purple/40 rounded-xl transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}

            {isTyping && (
              <div className="flex justify-start mb-3">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center text-xs shrink-0 mr-2 mt-0.5">
                  🎯
                </div>
                <div className="bg-dark-bg border border-dark-border rounded-2xl rounded-bl-md">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="shrink-0 border-t border-dark-border px-3 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                rows={1}
                disabled={chatMutation.isPending}
                className="flex-1 bg-dark-bg border border-dark-border rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors resize-none disabled:opacity-50 max-h-24 overflow-y-auto"
                style={{ lineHeight: '1.4' }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-accent-purple hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shrink-0"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <p className="text-[10px] text-slate-600 mt-1.5 text-center">
              Press Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 flex items-center justify-center rounded-full bg-gradient-to-br from-accent-purple to-accent-blue shadow-lg shadow-accent-purple/40 hover:shadow-accent-purple/60 hover:scale-105 transition-all"
        title="Open AgentHub Assistant"
      >
        {open ? (
          <X className="w-5 h-5 text-white" />
        ) : (
          <>
            <MessageCircle className="w-5 h-5 text-white" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 border-2 border-dark-bg flex items-center justify-center text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </>
        )}
      </button>
    </>
  )
}
