import { Router, Request, Response } from 'express';
import { db } from '../db';
import { settings, apiKeys } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();

// ─── Encryption helpers for API keys ──────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

async function getEncryptionKey(): Promise<Buffer> {
  // 1. From env
  if (process.env.ENCRYPTION_KEY) {
    const raw = process.env.ENCRYPTION_KEY;
    return crypto.createHash('sha256').update(raw).digest();
  }
  // 2. Auto-generate and persist in settings table
  const [row] = await db.select().from(settings).where(eq(settings.key, '__encryption_key'));
  if (row) {
    return Buffer.from(row.value, 'hex');
  }
  const newKey = crypto.randomBytes(32);
  await db.insert(settings).values({
    key: '__encryption_key',
    value: newKey.toString('hex'),
    updatedAt: new Date().toISOString(),
  });
  return newKey;
}

function encrypt(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(data: string, key: Buffer): string {
  const [ivHex, tagHex, encHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ─── Public helper: get decrypted API key for a provider ─────────────────────
// Used by executor.ts and business.ts instead of process.env

export async function getApiKeyForProvider(provider: string): Promise<string | null> {
  // 1. Check DB
  const [row] = await db.select().from(apiKeys)
    .where(and(eq(apiKeys.provider, provider), eq(apiKeys.isActive, true)));
  if (row) {
    try {
      const key = await getEncryptionKey();
      return decrypt(row.encryptedKey, key);
    } catch { /* decrypt failed, fall through */ }
  }
  // 2. Fallback to env
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || null;
  if (provider === 'openai') return process.env.OPENAI_API_KEY || null;
  return null;
}

// Helper: store an API key encrypted (used by setup.ts)
export async function storeApiKeyEncrypted(provider: string, name: string, rawKey: string): Promise<void> {
  const encKey = await getEncryptionKey();
  const encryptedKey = encrypt(rawKey, encKey);
  const keyHint = rawKey.slice(-4);
  const now = new Date().toISOString();

  // Upsert: deactivate existing keys for this provider, then insert new
  const existing = await db.select().from(apiKeys)
    .where(and(eq(apiKeys.provider, provider), eq(apiKeys.isActive, true)));

  if (existing.length > 0) {
    await db.update(apiKeys)
      .set({ encryptedKey, keyHint, updatedAt: now })
      .where(eq(apiKeys.id, existing[0].id));
  } else {
    await db.insert(apiKeys).values({
      name,
      provider,
      encryptedKey,
      keyHint,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// Helper: get a setting value
export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}

// Helper: set a setting value
export async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.select().from(settings).where(eq(settings.key, key));
  const now = new Date().toISOString();
  if (existing.length > 0) {
    await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value, updatedAt: now });
  }
}

// ─── GET /api/settings ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  try {
    const allSettings = await db.select().from(settings);
    // Filter out sensitive values
    const publicSettings = allSettings.filter((s) => !s.key.includes('key') && !s.key.includes('token'));
    res.json({ data: publicSettings });
  } catch (err: any) {
    console.error('[Settings] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ─── POST /api/settings/telegram-route ───────────────────────────────────────

router.post('/telegram-route', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.body;
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }
    await setSetting('telegram_default_agent_id', agentId);
    res.json({ success: true, message: 'Default Telegram agent set', agentId });
  } catch (err: any) {
    console.error('[Settings] POST /telegram-route error:', err);
    res.status(500).json({ error: 'Failed to set Telegram route' });
  }
});

// ─── GET /api/settings/telegram-routes ───────────────────────────────────────

router.get('/telegram-routes', async (req: Request, res: Response) => {
  try {
    const defaultAgentId = await getSetting('telegram_default_agent_id');
    const commandRoutesStr = await getSetting('telegram_command_routes');
    const commandRoutes = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};

    res.json({
      data: {
        defaultAgentId,
        commandRoutes,
      },
    });
  } catch (err: any) {
    console.error('[Settings] GET /telegram-routes error:', err);
    res.status(500).json({ error: 'Failed to fetch Telegram routes' });
  }
});

// ─── POST /api/settings/telegram-routes ──────────────────────────────────────

router.post('/telegram-routes', async (req: Request, res: Response) => {
  try {
    const { command, agentId } = req.body;
    if (!command || !agentId) {
      res.status(400).json({ error: 'command and agentId are required' });
      return;
    }

    const commandRoutesStr = await getSetting('telegram_command_routes');
    const commandRoutes = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};
    commandRoutes[command] = agentId;

    await setSetting('telegram_command_routes', JSON.stringify(commandRoutes));
    res.json({ success: true, message: `Command route ${command} set`, commandRoutes });
  } catch (err: any) {
    console.error('[Settings] POST /telegram-routes error:', err);
    res.status(500).json({ error: 'Failed to set Telegram command route' });
  }
});

// ─── DELETE /api/settings/telegram-routes/:command ───────────────────────────

router.delete('/telegram-routes/:command', async (req: Request, res: Response) => {
  try {
    const command = decodeURIComponent(req.params.command);
    const commandRoutesStr = await getSetting('telegram_command_routes');
    const commandRoutes = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};

    if (!commandRoutes[command]) {
      res.status(404).json({ error: `Command route "${command}" not found` });
      return;
    }

    delete commandRoutes[command];
    await setSetting('telegram_command_routes', JSON.stringify(commandRoutes));
    res.json({ success: true, message: `Command route ${command} removed`, commandRoutes });
  } catch (err: any) {
    console.error('[Settings] DELETE /telegram-routes/:command error:', err);
    res.status(500).json({ error: 'Failed to delete Telegram command route' });
  }
});

// ─── GET /api/settings/telegram-status ────────────────────────────────────────

router.get('/telegram-status', async (req: Request, res: Response) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || await getSetting('telegram_bot_token') || '';
    const hasToken = token.length > 10;
    res.json({ data: { connected: hasToken, token: hasToken ? `${token.slice(0, 5)}...${token.slice(-4)}` : '' } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get Telegram status' });
  }
});

// ─── POST /api/settings/telegram-token ───────────────────────────────────────

router.post('/telegram-token', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'token is required' });
      return;
    }
    await setSetting('telegram_bot_token', token);
    // Also set env for current process
    process.env.TELEGRAM_BOT_TOKEN = token;
    res.json({ success: true, message: 'Telegram bot token saved. Restart server to reconnect bot.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save Telegram token' });
  }
});

// ─── GET /api/settings/api-keys ─────────────────────────────────────────────
// Returns list with hint only — never full keys

router.get('/api-keys', async (req: Request, res: Response) => {
  try {
    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      provider: apiKeys.provider,
      keyHint: apiKeys.keyHint,
      isActive: apiKeys.isActive,
      createdAt: apiKeys.createdAt,
      updatedAt: apiKeys.updatedAt,
    }).from(apiKeys);
    res.json({ data: keys });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// ─── POST /api/settings/api-keys ─────────────────────────────────────────────
// Encrypt & store a new key

router.post('/api-keys', async (req: Request, res: Response) => {
  try {
    const { name, provider, key: rawKey } = req.body as { name: string; provider: string; key: string };
    if (!name || !provider || !rawKey) {
      res.status(400).json({ error: 'name, provider, and key are required' });
      return;
    }

    const encKey = await getEncryptionKey();
    const encryptedKey = encrypt(rawKey, encKey);
    const keyHint = rawKey.slice(-4);

    const [row] = await db.insert(apiKeys).values({
      name,
      provider,
      encryptedKey,
      keyHint,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    res.json({ data: { id: row.id, name: row.name, provider: row.provider, keyHint, isActive: true } });
  } catch (err: any) {
    console.error('[Settings] POST /api-keys error:', err);
    res.status(500).json({ error: 'Failed to store API key' });
  }
});

// ─── DELETE /api/settings/api-keys/:id ───────────────────────────────────────

router.delete('/api-keys/:id', async (req: Request, res: Response) => {
  try {
    await db.delete(apiKeys).where(eq(apiKeys.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// ─── POST /api/settings/api-keys/:id/test ────────────────────────────────────
// Decrypt key and make a real test API call

router.post('/api-keys/:id/test', async (req: Request, res: Response) => {
  try {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, req.params.id));
    if (!row) { res.status(404).json({ error: 'Key not found' }); return; }

    const encKey = await getEncryptionKey();
    const rawKey = decrypt(row.encryptedKey, encKey);

    if (row.provider === 'anthropic') {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey: rawKey });
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      res.json({ valid: true, model: resp.model });
    } else if (row.provider === 'openai') {
      const OpenAI = require('openai');
      const client = new OpenAI.default({ apiKey: rawKey });
      const models = await client.models.list();
      res.json({ valid: true, modelCount: models.data?.length || 0 });
    } else {
      res.json({ valid: true, message: 'Custom provider — cannot auto-test' });
    }
  } catch (err: any) {
    res.json({ valid: false, error: err.message || 'Test failed' });
  }
});

// ─── PATCH /api/settings/api-keys/:id ────────────────────────────────────────
// Toggle active status

router.patch('/api-keys/:id', async (req: Request, res: Response) => {
  try {
    const { isActive } = req.body;
    await db.update(apiKeys).set({
      isActive: !!isActive,
      updatedAt: new Date().toISOString(),
    }).where(eq(apiKeys.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

export default router;
