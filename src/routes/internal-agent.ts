import { Router, Request, Response } from 'express';

const router = Router();

const SYSTEM_PROMPT =
  'You are an AI assistant embedded in AgentHub, an AI agent orchestration platform. ' +
  'Help the user configure agents, understand the platform, and troubleshoot issues. ' +
  'Be concise, practical, and friendly. When explaining setup steps, use numbered lists. ' +
  'You know about all agent types: HTTP webhooks, Claude API, OpenAI API, Bash scripts, ' +
  'Claude Code CLI, OpenAI Codex CLI, Cursor IDE, OpenClaw, A2A Protocol, and the internal assistant.';

// POST /api/internal-agent/chat
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body as {
      message: string;
      history?: { role: 'user' | 'assistant'; content: string }[];
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!anthropicKey && !openaiKey) {
      res.status(503).json({
        error: 'No AI provider configured. Please set ANTHROPIC_API_KEY or OPENAI_API_KEY in setup.',
      });
      return;
    }

    const useAnthropic = !!anthropicKey;

    if (useAnthropic) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: anthropicKey });

      const messages: { role: 'user' | 'assistant'; content: string }[] = [];

      // Add conversation history
      if (history && Array.isArray(history)) {
        for (const msg of history) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: String(msg.content) });
          }
        }
      }

      // Add current message
      messages.push({ role: 'user', content: message.trim() });

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as any).text)
        .join('');

      res.json({
        success: true,
        message: text,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      });
    } else {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: openaiKey });

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: SYSTEM_PROMPT },
      ];

      // Add conversation history
      if (history && Array.isArray(history)) {
        for (const msg of history) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: String(msg.content) });
          }
        }
      }

      // Add current message
      messages.push({ role: 'user', content: message.trim() });

      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages,
      });

      const text = response.choices[0]?.message?.content || '';

      res.json({
        success: true,
        message: text,
        provider: 'openai',
        model: 'gpt-4o',
      });
    }
  } catch (err) {
    console.error('[InternalAgent] POST /chat error:', err);
    res.status(500).json({
      error: 'Failed to get response from AI',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
