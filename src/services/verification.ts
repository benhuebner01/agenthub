import { db } from '../db';
import { verifications, planSteps } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export interface VerificationCheck {
  name: string;
  type: 'schema_check' | 'rule_check' | 'second_pass' | 'human_approval' | 'custom';
  severity: 'error' | 'warning' | 'info';
  validate: (input: any) => Promise<{ passed: boolean; details: string; score?: number }>;
}

// Built-in verification checks
export const BUILT_IN_CHECKS: Record<string, (input: any) => Promise<{ passed: boolean; details: string; score?: number }>> = {
  'not_empty': async (input: any) => ({
    passed: input !== null && input !== undefined && input !== '' && (typeof input !== 'object' || Object.keys(input).length > 0),
    details: input ? 'Output is not empty' : 'Output is empty',
  }),
  'has_content': async (input: any) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return { passed: text.length > 10, details: `Content length: ${text.length} chars` };
  },
  'no_error_markers': async (input: any) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const errorPatterns = ['ERROR', 'FAILED', 'exception', 'undefined', 'null reference'];
    const found = errorPatterns.filter(p => text.toLowerCase().includes(p.toLowerCase()));
    return { passed: found.length === 0, details: found.length ? `Found error markers: ${found.join(', ')}` : 'No error markers found' };
  },
  'has_cta': async (input: any) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const ctaPatterns = ['click here', 'sign up', 'learn more', 'get started', 'buy now', 'subscribe', 'download', 'try', 'join', 'register'];
    const found = ctaPatterns.some(p => text.toLowerCase().includes(p));
    return { passed: found, details: found ? 'CTA found in content' : 'No CTA detected' };
  },
  'max_length_5000': async (input: any) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return { passed: text.length <= 5000, details: `Length: ${text.length}/5000` };
  },
  'json_valid': async (input: any) => {
    try {
      if (typeof input === 'string') JSON.parse(input);
      return { passed: true, details: 'Valid JSON' };
    } catch {
      return { passed: false, details: 'Invalid JSON' };
    }
  },
  'no_pii': async (input: any) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
    const hasEmail = emailRegex.test(text);
    const hasPhone = phoneRegex.test(text);
    return {
      passed: !hasEmail && !hasPhone,
      details: hasEmail || hasPhone ? `PII detected: ${hasEmail ? 'email ' : ''}${hasPhone ? 'phone' : ''}` : 'No PII detected'
    };
  },
};

/**
 * Run verification checks on a step's output
 */
export async function verifyStepOutput(
  stepId: string,
  output: any,
  checks: string[],
  options?: { runId?: string; agentId?: string }
): Promise<{ allPassed: boolean; results: any[] }> {
  const results: any[] = [];
  let allPassed = true;
  const now = new Date().toISOString();

  for (const checkName of checks) {
    const checkFn = BUILT_IN_CHECKS[checkName];
    if (!checkFn) {
      // Unknown check — record as skipped
      const [v] = await db.insert(verifications).values({
        id: uuidv4(),
        planStepId: stepId,
        runId: options?.runId || null,
        agentId: options?.agentId || null,
        type: 'custom',
        checkName,
        status: 'skipped',
        input: output,
        result: { passed: false, details: `Unknown check: ${checkName}` },
        severity: 'warning',
        resolvedBy: 'auto',
        createdAt: now,
        resolvedAt: now,
      }).returning();
      results.push(v);
      continue;
    }

    const result = await checkFn(output);
    const status = result.passed ? 'passed' : 'failed';
    if (!result.passed) allPassed = false;

    const [v] = await db.insert(verifications).values({
      id: uuidv4(),
      planStepId: stepId,
      runId: options?.runId || null,
      agentId: options?.agentId || null,
      type: 'rule_check',
      checkName,
      status,
      input: typeof output === 'string' ? { text: output.substring(0, 500) } : output,
      result,
      severity: 'error',
      resolvedBy: 'auto',
      createdAt: now,
      resolvedAt: now,
    }).returning();
    results.push(v);
  }

  // Update the plan step's verificationResult
  await db.update(planSteps).set({
    verificationResult: { passed: allPassed, checks: results.map((r: any) => ({ name: r.checkName, status: r.status, details: r.result })) },
    status: allPassed ? 'verified' : 'failed',
    updatedAt: now,
  }).where(eq(planSteps.id, stepId));

  return { allPassed, results };
}

/**
 * Create a human approval verification (pending until resolved)
 */
export async function requestHumanApproval(
  stepId: string,
  content: any,
  options?: { runId?: string; agentId?: string; notes?: string }
): Promise<any> {
  const now = new Date().toISOString();
  const [v] = await db.insert(verifications).values({
    id: uuidv4(),
    planStepId: stepId,
    runId: options?.runId || null,
    agentId: options?.agentId || null,
    type: 'human_approval',
    checkName: 'human_approval',
    status: 'awaiting_approval',
    input: content,
    severity: 'error',
    notes: options?.notes || null,
    createdAt: now,
  }).returning();
  return v;
}

/**
 * Resolve a human approval
 */
export async function resolveApproval(
  verificationId: string,
  approved: boolean,
  notes?: string
): Promise<any> {
  const now = new Date().toISOString();
  const [v] = await db.update(verifications).set({
    status: approved ? 'passed' : 'failed',
    resolvedBy: 'human',
    notes: notes || null,
    resolvedAt: now,
  }).where(eq(verifications.id, verificationId)).returning();
  return v;
}

/**
 * Get all verifications for a step
 */
export async function getStepVerifications(stepId: string) {
  return db.select().from(verifications).where(eq(verifications.planStepId, stepId));
}

/**
 * Get pending approvals
 */
export async function getPendingApprovals() {
  return db.select().from(verifications).where(eq(verifications.status, 'awaiting_approval'));
}
