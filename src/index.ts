import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import type { CorsOptions } from 'cors';
import path from 'path';
import rateLimit from 'express-rate-limit';

// Routes
import agentsRouter from './routes/agents';
import schedulesRouter from './routes/schedules';
import budgetsRouter from './routes/budgets';
import runsRouter from './routes/runs';
import setupRouter from './routes/setup';
import presetsRouter from './routes/presets';
import internalAgentRouter from './routes/internal-agent';
import businessRouter from './routes/business';
import costsRouter from './routes/costs';
import settingsRouter from './routes/settings';
import goalsRouter from './routes/goals';
import toolPoliciesRouter from './routes/tool-policies';
import workflowsRouter from './routes/workflows';
import verificationsRouter from './routes/verifications';

// Services
import { startScheduler, getSchedulerMode } from './services/scheduler';
import { startTelegramBot } from './services/telegram';
import { resetExpiredBudgets } from './services/budget';

// DB
import { mode as dbMode } from './db/index';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ─── P0-3: CORS Allowlist ────────────────────────────────────────────────────
// In production, only allow configured origins. In dev, allow all.
const corsOptions: CorsOptions = (() => {
  const originsEnv = process.env.CORS_ORIGINS; // comma-separated: "https://example.com,https://app.example.com"
  if (originsEnv) {
    const allowedOrigins = originsEnv.split(',').map(o => o.trim()).filter(Boolean);
    return {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (server-to-server, curl, mobile apps)
        if (!origin) { callback(null, true); return; }
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: Origin ${origin} not allowed`));
        }
      },
      credentials: true,
    };
  }
  // Dev mode: allow all origins (backward compatible)
  if (!IS_PRODUCTION) {
    return { origin: true, credentials: true };
  }
  // Production without CORS_ORIGINS: restrictive — same-origin only
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) { callback(null, true); return; } // server-to-server
      callback(new Error('CORS: No CORS_ORIGINS configured in production'));
    },
    credentials: true,
  };
})();
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── P0-4: Rate Limiting ─────────────────────────────────────────────────────
// Global rate limit: 200 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/api/health', // health checks exempt
});
app.use('/api', globalLimiter);

// Strict rate limits for sensitive endpoints
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many setup requests, please try again later.' },
});

const executionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many execution requests, please try again later.' },
});

// Request logging (redact sensitive headers in production)
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ─── P0-2: Setup Routes — Protected by Bootstrap Token in Production ─────────
// In production, setup endpoints require SETUP_TOKEN to prevent unauthorized config changes.
// In dev mode, setup works without a token (backward compatible).
app.use('/api/setup', setupLimiter, (req: Request, res: Response, next: NextFunction): void => {
  // GET /api/setup/status is always allowed (needed to check if setup is complete)
  if (req.method === 'GET' && req.path === '/status') {
    next();
    return;
  }

  const setupToken = process.env.SETUP_TOKEN;

  // In production, require SETUP_TOKEN for mutation endpoints
  if (IS_PRODUCTION && setupToken) {
    const providedToken = req.headers['x-setup-token'] as string || req.body?.setupToken;
    if (!providedToken || providedToken !== setupToken) {
      res.status(403).json({
        error: 'Setup requires authentication in production.',
        hint: 'Provide X-Setup-Token header or setupToken in body.',
      });
      return;
    }
  }

  next();
}, setupRouter);

// Presets — NO auth required (read-only public data)
app.use('/api/presets', presetsRouter);

// Internal agent chat — auth required for POST, rate limited
app.use('/api/internal-agent', executionLimiter, internalAgentRouter);

// ─── P0-1: API Key Authentication — Fail-Closed in Production ────────────────
// In production: ALL requests (including GET) require X-API-Key header.
// In dev without API_SECRET: auth is bypassed (backward compatible for local development).
// Unsafe defaults like "change-me-in-production" are blocked in production.
const apiAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // OPTIONS always passes (CORS preflight)
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const apiSecret = process.env.API_SECRET;

  // ── Production fail-closed ──
  if (IS_PRODUCTION) {
    if (!apiSecret || apiSecret === 'change-me-in-production') {
      res.status(503).json({
        error: 'Server misconfigured: API_SECRET not set for production.',
        hint: 'Set a strong API_SECRET environment variable before starting in production mode.',
      });
      return;
    }

    // ALL methods require auth in production (including GET)
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey || apiKey !== apiSecret) {
      res.status(401).json({ error: 'Unauthorized. Provide valid X-API-Key header.' });
      return;
    }

    next();
    return;
  }

  // ── Development mode ──
  // If no API_SECRET configured, allow everything (local dev convenience)
  if (!apiSecret || apiSecret === 'change-me-in-production') {
    next();
    return;
  }

  // API_SECRET is set in dev — enforce auth on ALL methods (including GET)
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey || apiKey !== apiSecret) {
    res.status(401).json({ error: 'Unauthorized. Provide valid X-API-Key header.' });
    return;
  }

  next();
};

app.use('/api', apiAuthMiddleware);

// Mount API routes
app.use('/api/agents', agentsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/runs', executionLimiter, runsRouter);
app.use('/api/business', businessRouter);
app.use('/api/costs', costsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/tool-policies', toolPoliciesRouter);
app.use('/api/verifications', verificationsRouter);
app.use('/api/workflows', workflowsRouter);

// Note: Proposals are served at /api/business/proposals by the business router

// Health check endpoint (no auth, no sensitive data)
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    // Don't expose env details in production
    ...(IS_PRODUCTION ? {} : { env: process.env.NODE_ENV, dbMode, schedulerMode: getSchedulerMode() }),
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

// Global error handler — never expose stack traces in production
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // CORS errors get a 403
  if (err.message && err.message.startsWith('CORS:')) {
    console.warn(`[CORS] Blocked: ${err.message} from ${req.headers.origin}`);
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  console.error('[Server] Unhandled error:', IS_PRODUCTION ? err.message : err);
  res.status(500).json({
    error: 'Internal server error',
    // Only expose error details in development
    ...(IS_PRODUCTION ? {} : { message: err.message }),
  });
});

async function runMigrations(): Promise<void> {
  if (dbMode === 'postgres') {
    console.log('[DB] Running PostgreSQL migrations...');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS organizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          description TEXT,
          industry TEXT,
          goals JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS agents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          config JSONB NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'active',
          parent_agent_id UUID,
          role TEXT NOT NULL DEFAULT 'worker',
          job_description TEXT,
          organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
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
        CREATE TABLE IF NOT EXISTS agent_memory (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(agent_id, key)
        );
        CREATE TABLE IF NOT EXISTS agent_calls (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          caller_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          callee_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
          input JSONB,
          output JSONB,
          status TEXT NOT NULL DEFAULT 'pending',
          cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS proposals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          proposed_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          details JSONB NOT NULL,
          reasoning TEXT,
          estimated_cost_usd NUMERIC(10,2),
          status TEXT NOT NULL DEFAULT 'pending',
          user_notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
        CREATE INDEX IF NOT EXISTS idx_proposals_organization_id ON proposals(organization_id);
        CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
        CREATE INDEX IF NOT EXISTS idx_agents_organization_id ON agents(organization_id);
        CREATE TABLE IF NOT EXISTS daily_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS knowledge_base (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS tacit_knowledge (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          topic TEXT NOT NULL,
          insight TEXT NOT NULL,
          confidence NUMERIC(3,2) DEFAULT 0.5,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_daily_notes_agent_id ON daily_notes(agent_id);
        CREATE INDEX IF NOT EXISTS idx_daily_notes_organization_id ON daily_notes(organization_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_base_agent_id ON knowledge_base(agent_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_base_organization_id ON knowledge_base(organization_id);
        CREATE INDEX IF NOT EXISTS idx_tacit_knowledge_agent_id ON tacit_knowledge(agent_id);

        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS setup_mode TEXT DEFAULT 'wizard';
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS team_plan_json TEXT;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS launch_state TEXT DEFAULT 'draft';

        CREATE TABLE IF NOT EXISTS ceo_prelaunch_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ceo_prelaunch_messages_org_id ON ceo_prelaunch_messages(organization_id);

        CREATE TABLE IF NOT EXISTS goals (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          priority TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'draft',
          success_criteria JSONB,
          constraints JSONB,
          deadline TEXT,
          measurable_target TEXT,
          progress INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_goals_organization_id ON goals(organization_id);
        CREATE INDEX IF NOT EXISTS idx_goals_agent_id ON goals(agent_id);
        CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

        CREATE TABLE IF NOT EXISTS plan_steps (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          assigned_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL DEFAULT 'action',
          "order" INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          depends_on JSONB,
          input JSONB,
          output JSONB,
          artifacts JSONB,
          verification JSONB,
          verification_result JSONB,
          retries INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 3,
          run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_plan_steps_goal_id ON plan_steps(goal_id);
        CREATE INDEX IF NOT EXISTS idx_plan_steps_assigned_agent_id ON plan_steps(assigned_agent_id);
        CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON plan_steps(status);

        CREATE TABLE IF NOT EXISTS tool_policies (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          tool_class TEXT,
          allowed_agent_ids JSONB,
          denied_agent_ids JSONB,
          mode TEXT NOT NULL DEFAULT 'execute',
          approval_required BOOLEAN NOT NULL DEFAULT false,
          max_calls_per_run INTEGER,
          max_calls_per_day INTEGER,
          max_cost_per_call_usd NUMERIC(10,4),
          required_conditions JSONB,
          forbidden_conditions JSONB,
          postconditions JSONB,
          enabled BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tool_policies_tool_name ON tool_policies(tool_name);
        CREATE INDEX IF NOT EXISTS idx_tool_policies_organization_id ON tool_policies(organization_id);

        CREATE TABLE IF NOT EXISTS verifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          plan_step_id UUID REFERENCES plan_steps(id) ON DELETE CASCADE,
          run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
          agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          check_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          input JSONB,
          result JSONB,
          severity TEXT NOT NULL DEFAULT 'error',
          resolved_by TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_verifications_plan_step_id ON verifications(plan_step_id);
        CREATE INDEX IF NOT EXISTS idx_verifications_run_id ON verifications(run_id);
        CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status);

        CREATE TABLE IF NOT EXISTS workflows (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          trigger TEXT NOT NULL DEFAULT 'manual',
          status TEXT NOT NULL DEFAULT 'draft',
          steps JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_organization_id ON workflows(organization_id);
        CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

        CREATE TABLE IF NOT EXISTS workflow_runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          current_step_id TEXT,
          step_results JSONB,
          input JSONB,
          output JSONB,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_goal_id ON workflow_runs(goal_id);
      `);

      // Add new columns to agents if they don't exist
      try {
        await pool.query(`
          ALTER TABLE agents ADD COLUMN IF NOT EXISTS parent_agent_id UUID;
          ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker';
          ALTER TABLE agents ADD COLUMN IF NOT EXISTS job_description TEXT;
          ALTER TABLE agents ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
        `);
      } catch {
        // Columns may already exist
      }

      console.log('[DB] PostgreSQL migrations complete');
    } finally {
      await pool.end();
    }
  } else {
    // SQLite mode
    const { sqlite } = await import('./db/index');

    const addColumnSafe = (sql: string) => {
      try { sqlite.exec(sql); } catch (_e) { /* already exists */ }
    };

    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          industry TEXT,
          goals TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'active',
          parent_agent_id TEXT,
          role TEXT NOT NULL DEFAULT 'worker',
          job_description TEXT,
          organization_id TEXT,
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
        CREATE TABLE IF NOT EXISTS agent_memory (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(agent_id, key)
        );
        CREATE TABLE IF NOT EXISTS agent_calls (
          id TEXT PRIMARY KEY,
          caller_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          callee_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          input TEXT,
          output TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          cost_usd REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS proposals (
          id TEXT PRIMARY KEY,
          organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
          proposed_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          details TEXT NOT NULL,
          reasoning TEXT,
          estimated_cost_usd REAL,
          status TEXT NOT NULL DEFAULT 'pending',
          user_notes TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_run_id ON audit_logs(run_id);
        CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls(run_id);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
        CREATE INDEX IF NOT EXISTS idx_proposals_organization_id ON proposals(organization_id);
        CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
        CREATE INDEX IF NOT EXISTS idx_agents_organization_id ON agents(organization_id);
        CREATE TABLE IF NOT EXISTS daily_notes (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS knowledge_base (
          id TEXT PRIMARY KEY,
          agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
          organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tacit_knowledge (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          topic TEXT NOT NULL,
          insight TEXT NOT NULL,
          confidence REAL DEFAULT 0.5,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_daily_notes_agent_id ON daily_notes(agent_id);
        CREATE INDEX IF NOT EXISTS idx_daily_notes_organization_id ON daily_notes(organization_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_base_agent_id ON knowledge_base(agent_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_base_organization_id ON knowledge_base(organization_id);
        CREATE INDEX IF NOT EXISTS idx_tacit_knowledge_agent_id ON tacit_knowledge(agent_id);
        CREATE TABLE IF NOT EXISTS ceo_prelaunch_messages (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ceo_prelaunch_messages_org_id ON ceo_prelaunch_messages(organization_id);
        CREATE TABLE IF NOT EXISTS goals (
          id TEXT PRIMARY KEY,
          organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
          agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          priority TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'draft',
          success_criteria TEXT,
          constraints TEXT,
          deadline TEXT,
          measurable_target TEXT,
          progress INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_goals_organization_id ON goals(organization_id);
        CREATE INDEX IF NOT EXISTS idx_goals_agent_id ON goals(agent_id);
        CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
        CREATE TABLE IF NOT EXISTS plan_steps (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL DEFAULT 'action',
          "order" INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          depends_on TEXT,
          input TEXT,
          output TEXT,
          artifacts TEXT,
          verification TEXT,
          verification_result TEXT,
          retries INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 3,
          run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_plan_steps_goal_id ON plan_steps(goal_id);
        CREATE INDEX IF NOT EXISTS idx_plan_steps_assigned_agent_id ON plan_steps(assigned_agent_id);
        CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON plan_steps(status);
        CREATE TABLE IF NOT EXISTS tool_policies (
          id TEXT PRIMARY KEY,
          organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          tool_class TEXT,
          allowed_agent_ids TEXT,
          denied_agent_ids TEXT,
          mode TEXT NOT NULL DEFAULT 'execute',
          approval_required INTEGER NOT NULL DEFAULT 0,
          max_calls_per_run INTEGER,
          max_calls_per_day INTEGER,
          max_cost_per_call_usd REAL,
          required_conditions TEXT,
          forbidden_conditions TEXT,
          postconditions TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tool_policies_tool_name ON tool_policies(tool_name);
        CREATE INDEX IF NOT EXISTS idx_tool_policies_organization_id ON tool_policies(organization_id);
        CREATE TABLE IF NOT EXISTS verifications (
          id TEXT PRIMARY KEY,
          plan_step_id TEXT REFERENCES plan_steps(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
          agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          type TEXT NOT NULL,
          check_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          input TEXT,
          result TEXT,
          severity TEXT NOT NULL DEFAULT 'error',
          resolved_by TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_verifications_plan_step_id ON verifications(plan_step_id);
        CREATE INDEX IF NOT EXISTS idx_verifications_run_id ON verifications(run_id);
        CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status);
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          trigger TEXT NOT NULL DEFAULT 'manual',
          status TEXT NOT NULL DEFAULT 'draft',
          steps TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_organization_id ON workflows(organization_id);
        CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          current_step_id TEXT,
          step_results TEXT,
          input TEXT,
          output TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_goal_id ON workflow_runs(goal_id);
      `);
    } catch (migrateErr) {
      console.warn('[DB] Migration warning (tables may already exist):', (migrateErr as Error).message);
    }

    // Safely add new columns to existing agents table
    addColumnSafe(`ALTER TABLE agents ADD COLUMN parent_agent_id TEXT`);
    addColumnSafe(`ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'worker'`);
    addColumnSafe(`ALTER TABLE agents ADD COLUMN job_description TEXT`);
    addColumnSafe(`ALTER TABLE agents ADD COLUMN organization_id TEXT`);

    addColumnSafe(`ALTER TABLE organizations ADD COLUMN setup_mode TEXT DEFAULT 'wizard'`);
    addColumnSafe(`ALTER TABLE organizations ADD COLUMN team_plan_json TEXT`);
    addColumnSafe(`ALTER TABLE organizations ADD COLUMN launch_state TEXT DEFAULT 'draft'`);

    console.log('[DB] SQLite migrations complete');
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

  // ─── P0-1: Fail-closed in production ─────────────────────────────────────────
  if (IS_PRODUCTION) {
    const apiSecret = process.env.API_SECRET;
    if (!apiSecret || apiSecret === 'change-me-in-production') {
      console.error('\n' + '!'.repeat(60));
      console.error('FATAL: Cannot start in production without a secure API_SECRET.');
      console.error('Set API_SECRET to a strong random value (32+ chars recommended).');
      console.error('Example: API_SECRET=$(openssl rand -hex 32)');
      console.error('!'.repeat(60));
      process.exit(1);
    }

    if (!process.env.CORS_ORIGINS) {
      console.warn('\n[Security] WARNING: CORS_ORIGINS not set in production.');
      console.warn('[Security] Only same-origin requests will be allowed.');
      console.warn('[Security] Set CORS_ORIGINS=https://yourdomain.com to allow cross-origin.');
    }

    if (!process.env.SETUP_TOKEN) {
      console.warn('\n[Security] WARNING: SETUP_TOKEN not set in production.');
      console.warn('[Security] Setup endpoints will reject mutation requests.');
    }

    console.log('\n[Security] Production security checks passed ✓');
    console.log(`[Security] CORS origins: ${process.env.CORS_ORIGINS || '(same-origin only)'}`);
    console.log(`[Security] Setup token: ${process.env.SETUP_TOKEN ? 'configured' : 'not set (mutations blocked)'}`);
    console.log(`[Security] Rate limiting: enabled`);
  } else {
    const apiSecret = process.env.API_SECRET;
    if (!apiSecret || apiSecret === 'change-me-in-production') {
      console.warn('\n[Security] Dev mode: API_SECRET not set — auth disabled.');
      console.warn('[Security] Set API_SECRET to enable auth in development.');
    } else {
      console.log('\n[Security] Dev mode: API_SECRET configured — auth enforced.');
    }
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
    // Detect LAN IP for easy access from other devices
    let lanIp = 'unknown';
    try {
      const os = require('os');
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal) { lanIp = net.address; break; }
        }
        if (lanIp !== 'unknown') break;
      }
    } catch {}

    console.log('\n' + '='.repeat(60));
    console.log(`  AgentHub running on port ${PORT}`);
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  LAN:     http://${lanIp}:${PORT}`);
    console.log(`  API:     http://localhost:${PORT}/api`);
    console.log(`  Health:  http://localhost:${PORT}/api/health`);
    if (lanIp !== 'unknown') {
      console.log(`\n  💡 Other devices on your network can access:`);
      console.log(`     http://${lanIp}:${PORT}`);
      console.log(`\n  ⚠️  If LAN access fails, check your firewall:`);
      console.log(`     Windows: Allow Node.js through Windows Firewall`);
      console.log(`     Linux:   sudo ufw allow ${PORT}`);
    }
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
