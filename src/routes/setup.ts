import { Router, Request, Response } from 'express';
import { db, mode } from '../db/index';
import { settings, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, key));
    return row ? row.value : null;
  } catch {
    return null;
  }
}

async function setSetting(key: string, value: string): Promise<void> {
  try {
    // Upsert — try insert, then update on conflict
    const existing = await getSetting(key);
    const now = new Date().toISOString();
    if (existing !== null) {
      await db
        .update(settings)
        .set({ value, updatedAt: now })
        .where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value, updatedAt: now });
    }
  } catch (err) {
    console.error(`[Setup] setSetting error for key "${key}":`, err);
    throw err;
  }
}

// ─── GET /api/setup/status ────────────────────────────────────────────────────

router.get('/status', async (req: Request, res: Response) => {
  try {
    const setupComplete = await getSetting('setup_complete');
    const hasAnthropicKey = !!(await getSetting('anthropic_api_key')) || !!process.env.ANTHROPIC_API_KEY;
    const hasOpenAIKey = !!(await getSetting('openai_api_key')) || !!process.env.OPENAI_API_KEY;
    const hasTelegramToken = !!(await getSetting('telegram_bot_token')) || !!process.env.TELEGRAM_BOT_TOKEN;

    // Check if any agent exists
    const agentRows = await db.select().from(agents).limit(1);
    const hasFirstAgent = agentRows.length > 0;

    res.json({
      complete: setupComplete === 'true',
      dbMode: mode,
      schedulerMode: process.env.REDIS_URL ? 'bullmq' : 'cron',
      steps: {
        apiKeys: hasAnthropicKey || hasOpenAIKey,
        telegram: hasTelegramToken,
        firstAgent: hasFirstAgent,
      },
    });
  } catch (err) {
    console.error('[Setup] GET /status error:', err);
    res.status(500).json({ error: 'Failed to get setup status' });
  }
});

// ─── POST /api/setup/complete ─────────────────────────────────────────────────

router.post('/complete', async (req: Request, res: Response) => {
  try {
    await setSetting('setup_complete', 'true');
    res.json({ success: true, message: 'Setup marked as complete' });
  } catch (err) {
    console.error('[Setup] POST /complete error:', err);
    res.status(500).json({ error: 'Failed to complete setup' });
  }
});

// ─── POST /api/setup/api-keys ─────────────────────────────────────────────────

router.post('/api-keys', async (req: Request, res: Response) => {
  try {
    const { anthropicKey, openaiKey, apiSecret } = req.body as {
      anthropicKey?: string;
      openaiKey?: string;
      apiSecret?: string;
    };

    if (anthropicKey && anthropicKey.trim()) {
      await setSetting('anthropic_api_key', anthropicKey.trim());
      // Also set in process.env for current session
      process.env.ANTHROPIC_API_KEY = anthropicKey.trim();
    }

    if (openaiKey && openaiKey.trim()) {
      await setSetting('openai_api_key', openaiKey.trim());
      process.env.OPENAI_API_KEY = openaiKey.trim();
    }

    if (apiSecret && apiSecret.trim()) {
      await setSetting('api_secret', apiSecret.trim());
      process.env.API_SECRET = apiSecret.trim();
    }

    res.json({ success: true, message: 'API keys saved' });
  } catch (err) {
    console.error('[Setup] POST /api-keys error:', err);
    res.status(500).json({ error: 'Failed to save API keys' });
  }
});

// ─── POST /api/setup/telegram ─────────────────────────────────────────────────

router.post('/telegram', async (req: Request, res: Response) => {
  try {
    const { botToken, authorizedUsers } = req.body as {
      botToken?: string;
      authorizedUsers?: string;
    };

    if (!botToken || !botToken.trim()) {
      res.status(400).json({ error: 'botToken is required' });
      return;
    }

    // Verify token with Telegram
    const telegramRes = await axios.get(
      `https://api.telegram.org/bot${botToken.trim()}/getMe`,
      { timeout: 10000, validateStatus: () => true }
    );

    if (!telegramRes.data?.ok) {
      res.status(400).json({
        error: 'Invalid Telegram bot token',
        detail: telegramRes.data?.description || 'Token verification failed',
      });
      return;
    }

    await setSetting('telegram_bot_token', botToken.trim());
    process.env.TELEGRAM_BOT_TOKEN = botToken.trim();

    if (authorizedUsers && authorizedUsers.trim()) {
      await setSetting('telegram_authorized_users', authorizedUsers.trim());
    }

    res.json({
      success: true,
      message: 'Telegram configuration saved',
      botName: telegramRes.data.result?.username,
      botId: telegramRes.data.result?.id,
    });
  } catch (err) {
    console.error('[Setup] POST /telegram error:', err);
    res.status(500).json({ error: 'Failed to save Telegram configuration' });
  }
});

// ─── GET /api/setup/test-telegram ─────────────────────────────────────────────

router.get('/test-telegram', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;

    if (!token || !token.trim()) {
      res.status(400).json({ error: 'token query parameter is required' });
      return;
    }

    const telegramRes = await axios.get(
      `https://api.telegram.org/bot${token.trim()}/getMe`,
      { timeout: 10000, validateStatus: () => true }
    );

    if (!telegramRes.data?.ok) {
      res.status(400).json({
        valid: false,
        error: telegramRes.data?.description || 'Invalid token',
      });
      return;
    }

    res.json({
      valid: true,
      botName: telegramRes.data.result?.username,
      botId: telegramRes.data.result?.id,
      firstName: telegramRes.data.result?.first_name,
    });
  } catch (err) {
    console.error('[Setup] GET /test-telegram error:', err);
    res.status(500).json({ error: 'Failed to test Telegram token', valid: false });
  }
});

// ─── GET /api/setup/discover-openclaw ────────────────────────────────────────

router.get('/discover-openclaw', async (req: Request, res: Response) => {
  try {
    const host = (req.query.host as string) || 'localhost';
    const port = parseInt((req.query.port as string) || '18789', 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      res.status(400).json({ error: 'Invalid port number' });
      return;
    }

    const baseURL = `http://${host}:${port}`;

    // Use OpenClaw's real health endpoint: GET /api/health
    const response = await axios.get(`${baseURL}/api/health`, {
      timeout: 5000,
      validateStatus: () => true,
    });

    if (response.status === 200) {
      // Also try to fetch running agents for extra info (best-effort)
      let agents: any[] = [];
      try {
        const ar = await axios.get(`${baseURL}/api/agents`, { timeout: 3000, validateStatus: () => true });
        if (ar.status === 200) agents = ar.data?.agents || ar.data || [];
      } catch { /* ignore */ }

      res.json({
        connected: true,
        host,
        port,
        models: [], // OpenClaw selects model via body param, no /models list
        version: response.data?.version || response.headers['x-openclaw-version'] || null,
        agents,
        raw: response.data,
      });
    } else {
      res.json({
        connected: false,
        host,
        port,
        error: `Received HTTP ${response.status} from OpenClaw`,
      });
    }
  } catch (err: any) {
    const isConnRefused =
      err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND';
    res.json({
      connected: false,
      host: (req.query.host as string) || 'localhost',
      port: parseInt((req.query.port as string) || '18789', 10),
      error: isConnRefused
        ? 'OpenClaw is not running on this host/port'
        : (err.message || 'Connection failed'),
    });
  }
});

// ─── POST /api/setup/fetch-a2a-card ──────────────────────────────────────────

router.post('/fetch-a2a-card', async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body as { endpoint?: string };

    if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }

    // Derive the well-known URL from the endpoint
    let cardUrl: string;
    try {
      const url = new URL(endpoint.trim());
      cardUrl = `${url.protocol}//${url.host}/.well-known/agent-card.json`;
    } catch {
      res.status(400).json({ error: 'Invalid endpoint URL' });
      return;
    }

    const response = await axios.get(cardUrl, {
      timeout: 8000,
      validateStatus: () => true,
      headers: { Accept: 'application/json' },
    });

    if (response.status === 200 && response.data) {
      res.json({
        found: true,
        cardUrl,
        card: response.data,
      });
    } else {
      res.json({
        found: false,
        cardUrl,
        error: `Agent card not found (HTTP ${response.status})`,
      });
    }
  } catch (err: any) {
    console.error('[Setup] POST /fetch-a2a-card error:', err);
    res.json({
      found: false,
      error: err.message || 'Failed to fetch agent card',
    });
  }
});

export default router;
