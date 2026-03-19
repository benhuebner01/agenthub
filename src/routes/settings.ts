import { Router, Request, Response } from 'express';
import { db } from '../db';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = Router();

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

export default router;
