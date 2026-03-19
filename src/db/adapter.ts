import 'dotenv/config';

export type DbMode = 'sqlite' | 'postgres';
export type SchedulerMode = 'cron' | 'bullmq';

export function getDbMode(): DbMode {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('postgresql')) return 'postgres';
  return 'sqlite';
}

export function getSchedulerMode(): SchedulerMode {
  return process.env.REDIS_URL ? 'bullmq' : 'cron';
}
