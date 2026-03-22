import { Router, Request, Response } from 'express';
import { getApiKeyForProvider, getSetting, setSetting } from './settings';

const router = Router();

const SYSTEM_PROMPT =
  'You are an AI assistant embedded in AgentHub, an AI agent orchestration platform. ' +
  'Help the user configure agents, understand the platform, and troubleshoot issues. ' +
  'Be concise, practical, and friendly. When explaining setup steps, use numbered lists. ' +
  'You know about all agent types: HTTP webhooks, Claude API, OpenAI API, Bash scripts, ' +
  'Claude Code CLI, OpenAI Codex CLI, Cursor IDE, OpenClaw, A2A Protocol, and the internal assistant.';

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

    // Get user-configured provider and model from settings
    const configuredProvider = await getSetting('assistant_provider') || 'anthropic';
    const configuredModel = await getSetting('assistant_model');

    // Try DB-stored encrypted key first, then env var
    let anthropicKey = await getApiKeyForProvider('anthropic');
    if (!anthropicKey) anthropicKey = process.env.ANTHROPIC_API_KEY || null;

    let openaiKey = await getApiKeyForProvider('openai');
    if (!openaiKey) openaiKey = process.env.OPENAI_API_KEY || null;

    // Determine which provider to use based on config and available keys
    let useAnthropic = configuredProvider === 'anthropic' && !!anthropicKey;
    if (!useAnthropic && !openaiKey) {
      // Fallback: try anthropic even if not configured
      useAnthropic = !!anthropicKey;
    }

    if (!anthropicKey && !openaiKey) {
      res.status(503).json({
        error: 'No AI provider configured. Add an API key in Settings > API Keys.',
      });
      return;
    }

    if (useAnthropic) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: anthropicKey! });
      const model = configuredModel || 'claude-sonnet-4-6';

      const messages: { role: 'user' | 'assistant'; content: string }[] = [];
      if (history && Array.isArray(history)) {
        for (const msg of history) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: String(msg.content) });
          }
        }
      }
      messages.push({ role: 'user', content: message.trim() });

      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as any).text)
        .join('');

      res.json({ success: true, message: text, provider: 'anthropic', model });
    } else {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: openaiKey! });
      const model = configuredModel || 'gpt-4o';

      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: SYSTEM_PROMPT },
      ];
      if (history && Array.isArray(history)) {
        for (const msg of history) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: String(msg.content) });
          }
        }
      }
      messages.push({ role: 'user', content: message.trim() });

      // GPT-5/o-series models require max_completion_tokens instead of max_tokens
      const useNewParam = /^(gpt-5|o\d)/.test(model);
      const response = await client.chat.completions.create({
        model,
        ...(useNewParam ? { max_completion_tokens: 1024 } : { max_tokens: 1024 }),
        messages,
      });

      const text = response.choices[0]?.message?.content || '';
      res.json({ success: true, message: text, provider: 'openai', model });
    }
  } catch (err) {
    console.error('[InternalAgent] POST /chat error:', err);
    res.status(500).json({
      error: 'Failed to get response from AI',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// GET /api/internal-agent/settings - Get current assistant config
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const provider = await getSetting('assistant_provider') || 'anthropic';
    const model = await getSetting('assistant_model') || '';
    res.json({ data: { provider, model } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get assistant settings' });
  }
});

// POST /api/internal-agent/settings - Update assistant config
router.post('/settings', async (req: Request, res: Response) => {
  try {
    const { provider, model } = req.body;
    if (provider) await setSetting('assistant_provider', provider);
    if (model) await setSetting('assistant_model', model);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save assistant settings' });
  }
});

export default router;
