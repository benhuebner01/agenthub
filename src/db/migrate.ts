import 'dotenv/config';
import { Pool } from 'pg';

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('Starting database migration...');
  console.log(`Connecting to: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://***@')}`);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Creating enums...');

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE agent_type AS ENUM ('http', 'claude', 'openai', 'bash');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE agent_status AS ENUM ('active', 'paused', 'error');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE run_status AS ENUM ('pending', 'running', 'success', 'failed', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE triggered_by AS ENUM ('schedule', 'manual', 'telegram', 'api');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE budget_period AS ENUM ('daily', 'weekly', 'monthly');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    console.log('Creating agents table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        type agent_type NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        status agent_status NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Creating schedules table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        cron_expression VARCHAR(255) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        last_run_at TIMESTAMP,
        next_run_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Creating runs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        schedule_id UUID REFERENCES schedules(id) ON DELETE SET NULL,
        status run_status NOT NULL DEFAULT 'pending',
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP,
        input JSONB,
        output JSONB,
        error TEXT,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
        triggered_by triggered_by NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Creating budgets table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
        period budget_period NOT NULL DEFAULT 'monthly',
        limit_usd NUMERIC(10, 2) NOT NULL,
        current_spend NUMERIC(10, 6) NOT NULL DEFAULT 0,
        period_start TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Creating audit_logs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
        agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        event_type VARCHAR(255) NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Creating tool_calls table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        tool_name VARCHAR(255) NOT NULL,
        input JSONB,
        output JSONB,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Creating telegram_users table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id BIGINT NOT NULL UNIQUE,
        username VARCHAR(255),
        first_name VARCHAR(255),
        authorized BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Creating indexes...');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_schedules_agent_id ON schedules(agent_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_runs_agent_id ON runs(agent_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_agent_id ON audit_logs(agent_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_run_id ON audit_logs(run_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls(run_id);`);

    await client.query('COMMIT');
    console.log('Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
