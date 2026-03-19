import { Router, Request, Response } from 'express';
import { db } from '../db';
import { agentMemory, agents } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const router = Router({ mergeParams: true });

// GET /api/agents/:id/memory
router.get('/', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const memories = await db.select().from(agentMemory).where(eq(agentMemory.agentId, agentId));
    res.json({ data: memories, total: memories.length });
  } catch (err: any) {
    console.error('[Memory] GET error:', err);
    res.status(500).json({ error: 'Failed to fetch agent memory' });
  }
});

// POST /api/agents/:id/memory — set a key-value pair
router.post('/', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const { key, value } = req.body;

    if (!key || value === undefined) {
      res.status(400).json({ error: 'key and value are required' });
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const now = new Date().toISOString();

    // Upsert: try update first, then insert
    const existing = await db.select().from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    if (existing.length > 0) {
      const [updated] = await db.update(agentMemory)
        .set({ value: String(value), updatedAt: now })
        .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)))
        .returning();
      res.json({ data: updated });
    } else {
      const [created] = await db.insert(agentMemory).values({
        id: uuidv4(),
        agentId,
        key,
        value: String(value),
        updatedAt: now,
      }).returning();
      res.status(201).json({ data: created });
    }
  } catch (err: any) {
    console.error('[Memory] POST error:', err);
    res.status(500).json({ error: 'Failed to set memory' });
  }
});

// DELETE /api/agents/:id/memory/:key
router.delete('/:key', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const key = req.params.key;

    const existing = await db.select().from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    if (existing.length === 0) {
      res.status(404).json({ error: 'Memory key not found' });
      return;
    }

    await db.delete(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    res.json({ message: 'Memory key deleted' });
  } catch (err: any) {
    console.error('[Memory] DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete memory key' });
  }
});

export default router;
