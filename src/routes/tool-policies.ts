import { Router, Request, Response } from 'express';
import { db } from '../db';
import { toolPolicies } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { checkToolPermission, getOrgPolicies } from '../services/toolGovernance';

const router = Router();

// GET /api/tool-policies — list all policies
router.get('/', async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.query;
    const policies = await getOrgPolicies(organizationId as string);
    res.json(policies);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tool-policies/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [policy] = await db.select().from(toolPolicies).where(eq(toolPolicies.id, req.params.id));
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json(policy);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tool-policies — create a policy
router.post('/', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const [policy] = await db.insert(toolPolicies).values({
      id: uuidv4(),
      ...req.body,
      createdAt: now,
      updatedAt: now,
    }).returning();
    res.status(201).json(policy);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/tool-policies/:id — update a policy
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const updates = { ...req.body, updatedAt: now };
    delete updates.id;
    delete updates.createdAt;
    const [policy] = await db.update(toolPolicies).set(updates).where(eq(toolPolicies.id, req.params.id)).returning();
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json(policy);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/tool-policies/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [policy] = await db.delete(toolPolicies).where(eq(toolPolicies.id, req.params.id)).returning();
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tool-policies/check — check if an agent can use a tool (runtime check endpoint)
router.post('/check', async (req: Request, res: Response) => {
  try {
    const { agentId, toolName, organizationId, runId, estimatedCostUsd } = req.body;
    if (!agentId || !toolName) return res.status(400).json({ error: 'agentId and toolName required' });
    const result = await checkToolPermission({ agentId, toolName, organizationId, runId, estimatedCostUsd });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
