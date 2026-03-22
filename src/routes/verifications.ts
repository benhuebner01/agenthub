import { Router, Request, Response } from 'express';
import { db } from '../db';
import { verifications } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verifyStepOutput, requestHumanApproval, resolveApproval, getStepVerifications, getPendingApprovals, BUILT_IN_CHECKS } from '../services/verification';

const router = Router();

// GET /api/verifications — list all or filter by stepId/runId
router.get('/', async (req: Request, res: Response) => {
  try {
    const { stepId, runId, status } = req.query;
    if (stepId) {
      const results = await getStepVerifications(stepId as string);
      return res.json(results);
    }
    if (status === 'awaiting_approval') {
      const results = await getPendingApprovals();
      return res.json(results);
    }
    const all = await db.select().from(verifications);
    res.json(all);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verifications/checks — list available built-in checks
router.get('/checks', async (_req: Request, res: Response) => {
  res.json(Object.keys(BUILT_IN_CHECKS));
});

// POST /api/verifications/verify — run verification checks on a step
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { stepId, output, checks, runId, agentId } = req.body;
    if (!stepId || !checks || !Array.isArray(checks)) {
      return res.status(400).json({ error: 'stepId and checks[] required' });
    }
    const result = await verifyStepOutput(stepId, output, checks, { runId, agentId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/verifications/request-approval — create a human approval request
router.post('/request-approval', async (req: Request, res: Response) => {
  try {
    const { stepId, content, runId, agentId, notes } = req.body;
    if (!stepId) return res.status(400).json({ error: 'stepId required' });
    const v = await requestHumanApproval(stepId, content, { runId, agentId, notes });
    res.json(v);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/verifications/:id/resolve — resolve a human approval
router.post('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { approved, notes } = req.body;
    if (approved === undefined) return res.status(400).json({ error: 'approved (boolean) required' });
    const v = await resolveApproval(req.params.id, approved, notes);
    if (!v) return res.status(404).json({ error: 'Verification not found' });
    res.json(v);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/verifications/pending — get pending approvals
router.get('/pending', async (_req: Request, res: Response) => {
  try {
    const pending = await getPendingApprovals();
    res.json(pending);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
