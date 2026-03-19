import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';

// Routes
import agentsRouter from './routes/agents';
import schedulesRouter from './routes/schedules';
import budgetsRouter from './routes/budgets';
import runsRouter from './routes/runs';

// Services
import { startScheduler } from './services/scheduler';
import { startTelegramBot } from './services/telegram';
import { resetExpiredBudgets } from './services/budget';

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

// API Key authentication middleware (protect mutation endpoints)
const apiAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
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

async function main() {
  console.log('='.repeat(60));
  console.log('⚡ AgentHub - AI Agent Orchestration Platform');
  console.log('='.repeat(60));
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://***@') || 'not configured'}`);
  console.log(`Redis: ${process.env.REDIS_URL || 'not configured'}`);

  // Run migrations on startup
  console.log('\n[DB] Running migrations...');
  try {
    const { execSync } = require('child_process');
    // Import and run migration directly
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();

    try {
      // Quick check if tables exist
      const result = await client.query(`
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'agents'
      `);
      const tablesExist = parseInt(result.rows[0].count, 10) > 0;

      if (!tablesExist) {
        console.log('[DB] Tables not found, running migration...');
        // Dynamically import and run migration
        require('./db/migrate');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        console.log('[DB] Tables already exist, skipping migration');
      }
    } finally {
      client.release();
      await pool.end();
    }
  } catch (err) {
    console.warn('[DB] Migration check failed (this is normal on first run):', (err as Error).message);
    console.warn('[DB] Run `npm run migrate` manually if needed');
  }

  // Start BullMQ scheduler
  console.log('\n[Scheduler] Starting...');
  try {
    await startScheduler();
  } catch (err) {
    console.error('[Scheduler] Failed to start:', (err as Error).message);
    console.warn('[Scheduler] Scheduler disabled - check Redis connection');
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
  }, 60 * 60 * 1000); // every hour

  // Start HTTP server
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log(`✅ AgentHub running at http://0.0.0.0:${PORT}`);
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
