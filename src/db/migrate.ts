import 'dotenv/config';
import { mode, sqlite } from './index';

const sqliteDDL = `
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
    type TEXT NOT NULL CHECK(type IN ('http','claude','openai','bash','claude-code','openai-codex','cursor','openclaw','a2a','internal')),
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','error')),
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
  CREATE TABLE IF NOT EXISTS shared_memory (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id, key)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_proposals_organization_id ON proposals(organization_id);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_agents_organization_id ON agents(organization_id);
  CREATE INDEX IF NOT EXISTS idx_shared_memory_org_id ON shared_memory(organization_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
`;

const pgDDL = `
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
  CREATE TABLE IF NOT EXISTS shared_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, key)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    key_hint TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_proposals_organization_id ON proposals(organization_id);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_agents_organization_id ON agents(organization_id);
  CREATE INDEX IF NOT EXISTS idx_shared_memory_org_id ON shared_memory(organization_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
`;

async function migrate() {
  console.log(`Running migrations in ${mode} mode...`);

  if (mode === 'sqlite') {
    sqlite.exec(sqliteDDL);

    // Safe ADD COLUMN for existing databases that don't have the new columns yet
    const addColumnSafe = (sql: string) => {
      try { sqlite.exec(sql); } catch (_e) { /* column already exists, ignore */ }
    };

    addColumnSafe(`ALTER TABLE agents ADD COLUMN parent_agent_id TEXT`);
    addColumnSafe(`ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'worker'`);
    addColumnSafe(`ALTER TABLE agents ADD COLUMN job_description TEXT`);
    addColumnSafe(`ALTER TABLE agents ADD COLUMN organization_id TEXT`);

    // Org status
    addColumnSafe(`ALTER TABLE organizations ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);

    // Run detail fields
    addColumnSafe(`ALTER TABLE runs ADD COLUMN model TEXT`);
    addColumnSafe(`ALTER TABLE runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0`);
    addColumnSafe(`ALTER TABLE runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0`);
    addColumnSafe(`ALTER TABLE runs ADD COLUMN duration_ms INTEGER`);

    // Goal replanning + summary fields
    addColumnSafe(`ALTER TABLE goals ADD COLUMN max_replans INTEGER NOT NULL DEFAULT 2`);
    addColumnSafe(`ALTER TABLE goals ADD COLUMN replan_count INTEGER NOT NULL DEFAULT 0`);
    addColumnSafe(`ALTER TABLE goals ADD COLUMN replan_reason TEXT`);
    addColumnSafe(`ALTER TABLE goals ADD COLUMN summary TEXT`);

    console.log('Migrations complete (SQLite)');
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(pgDDL);

      // Safe ADD COLUMN IF NOT EXISTS for Postgres
      await pool.query(`
        ALTER TABLE agents ADD COLUMN IF NOT EXISTS parent_agent_id UUID;
        ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker';
        ALTER TABLE agents ADD COLUMN IF NOT EXISTS job_description TEXT;
        ALTER TABLE agents ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS model TEXT;
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
        ALTER TABLE goals ADD COLUMN IF NOT EXISTS max_replans INTEGER NOT NULL DEFAULT 2;
        ALTER TABLE goals ADD COLUMN IF NOT EXISTS replan_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE goals ADD COLUMN IF NOT EXISTS replan_reason TEXT;
        ALTER TABLE goals ADD COLUMN IF NOT EXISTS summary TEXT;
      `);

      console.log('Migrations complete (PostgreSQL)');
    } finally {
      await pool.end();
    }
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

export default migrate;
