import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';

// Routes
import agentsRouter from './routes/agents';
import schedulesRouter from './routes/schedules';
import budgetsRouter from './routes/budgets';
import runsRouter from './routes/runs';
import setupRouter from './routes/setup';

// Services
import { startScheduler, getSchedulerMode } from './services/scheduler';
import { startTelegramBot } from './services/telegram';
import { resetExpiredBudgets } from './services/budget';

// DB
import { mode as dbMode } from './db/index';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Setup routes — NO auth required (must be before apiAuthMiddleware)
app.use('/api/setup', setupRouter);

// API Key authentication middleware (protect mutation endpoints)
const apiAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Setup routes are always public — no auth required
  if (req.path.startsWith('/setup')) {
    next();
    return;
  }

  const apiSecret = process.env.API_SECRET;

  // Skip auth if no secret is configured
  if (!apiSecret || apiSecret === 'change-me-in-production') {
    next();
    return;
  }

  // Allow all GET requests without auth (read-only)
  if (req.method === 'GET') {
    next();
    return;
  }

  // Allow OPTIONS for CORS preflight
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey || apiKey !== apiSecret) {
    res.status(401).json({ error: 'Unauthorized. Provide X-API-Key header.' });
    return;
  }

  next();
};

app.use('/api', apiAuthMiddleware);

// Mount API routes
app.use('/api/agents', agentsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/runs', runsRouter);

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV,
    dbMode,
    schedulerMode: getSchedulerMode(),
  });
});

// Serve static files (web dashboard)
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Catch-all to serve index.html for SPA routing
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'API endpoint not found' });
    return;
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

async function runMigrations(): Promise<void> {
  if (dbMode === 'postgres') {
    console.log('[DB] Running PostgreSQL migrations...');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          config JSONB NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS schedules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          cron_expression TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          last_run_at TIMESTAMPTZ,
          next_run_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          input JSONB,
          output JSONB,
          error TEXT,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
          triggered_by TEXT NOT NULL DEFAULT 'manual',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS budgets (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
          period TEXT NOT NULL DEFAULT 'monthly',
          limit_usd NUMERIC(10,2) NOT NULL,
          current_spend NUMERIC(10,6) NOT NULL DEFAULT 0,
          period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
          agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          data JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS tool_calls (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          input JSONB,
          output JSONB,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS telegram_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          telegram_id BIGINT NOT NULL UNIQUE,
          username TEXT,
          first_name TEXT,
          authorized BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);
      `);
      console.log('[DB] PostgreSQL migrations complete');
    } finally {
      await pool.end();
    }
  } else {
    // SQLite mode
    const { sqlite } = await import('./db/index');
    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          cron_expression TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT,
          next_run_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          schedule_id TEXT REFERENCES schedules(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TEXT NOT NULL,
          completed_at TEXT,
          input TEXT,
          output TEXT,
          error TEXT,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          triggered_by TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS budgets (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
          period TEXT NOT NULL DEFAULT 'monthly',
          limit_usd REAL NOT NULL,
          current_spend REAL NOT NULL DEFAULT 0,
          period_start TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          data TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tool_calls (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          input TEXT,
          output TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS telegram_users (
          id TEXT PRIMARY KEY,
          telegram_id INTEGER NOT NULL UNIQUE,
          username TEXT,
          first_name TEXT,
          authorized INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_run_id ON audit_logs(run_id);
        CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls(run_id);
      `);
      console.log('[DB] SQLite migrations complete');
    } catch (migrateErr) {
      console.warn('[DB] Migration warning (tables may already exist):', (migrateErr as Error).message);
    }
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('AgentHub - AI Agent Orchestration Platform');
  console.log('='.repeat(60));
  console.log(`Environment:   ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database mode: ${dbMode}`);
  console.log(`Scheduler mode: ${process.env.REDIS_URL ? 'bullmq' : 'cron'}`);
  if (dbMode === 'sqlite') {
    console.log(`Data directory: ${process.env.DATA_DIR || './data'}`);
  }

  // Run migrations on startup
  console.log('\n[DB] Running migrations...');
  try {
    await runMigrations();
  } catch (err) {
    console.error('[DB] Migration failed:', err);
    process.exit(1);
  }

  // Start scheduler (cron or BullMQ)
  console.log('\n[Scheduler] Starting...');
  try {
    await startScheduler();
  } catch (err) {
    console.error('[Scheduler] Failed to start:', (err as Error).message);
  }

  // Start Telegram bot
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log('\n[Telegram] Starting bot...');
    try {
      await startTelegramBot();
    } catch (err) {
      console.error('[Telegram] Failed to start:', (err as Error).message);
    }
  } else {
    console.log('\n[Telegram] No token configured, bot disabled');
  }

  // Schedule budget reset check every hour
  setInterval(async () => {
    try {
      await resetExpiredBudgets();
    } catch (err) {
      console.error('[Budget] Reset check failed:', err);
    }
  }, 60 * 60 * 1000);

  // Start HTTP server
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log(`AgentHub running at http://0.0.0.0:${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}`);
    console.log(`   API:       http://localhost:${PORT}/api`);
    console.log(`   Health:    http://localhost:${PORT}/api/health`);
    console.log('='.repeat(60));
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      const { stopScheduler } = await import('./services/scheduler');
      await stopScheduler();
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});

export default app;
