import { Router, Request, Response } from 'express';
import { db } from '../db';
import { agentMemory, agents, dailyNotes, knowledgeBase, tacitKnowledge } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const router = Router({ mergeParams: true });

// ─── Agent Memory (existing) ──────────────────────────────────────────────────

// GET /api/agents/:id/memory
router.get('/memory', async (req: Request, res: Response) => {
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
router.post('/memory', async (req: Request, res: Response) => {
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
router.delete('/memory/:key', async (req: Request, res: Response) => {
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

// ─── Daily Notes ──────────────────────────────────────────────────────────────

// GET /api/agents/:id/daily-notes — list all daily notes for agent
router.get('/daily-notes', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const notes = await db.select().from(dailyNotes).where(eq(dailyNotes.agentId, agentId));
    res.json({ data: notes, total: notes.length });
  } catch (err: any) {
    console.error('[Memory] GET /daily-notes error:', err);
    res.status(500).json({ error: 'Failed to fetch daily notes' });
  }
});

// GET /api/agents/:id/daily-notes/:date — get note for specific date
router.get('/daily-notes/:date', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const date = req.params.date;

    const [note] = await db.select().from(dailyNotes)
      .where(and(eq(dailyNotes.agentId, agentId), eq(dailyNotes.date, date)));

    if (!note) {
      res.status(404).json({ error: 'Daily note not found' });
      return;
    }

    res.json({ data: note });
  } catch (err: any) {
    console.error('[Memory] GET /daily-notes/:date error:', err);
    res.status(500).json({ error: 'Failed to fetch daily note' });
  }
});

// POST /api/agents/:id/daily-notes — create/update note
router.post('/daily-notes', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const { date, content } = req.body;

    if (!date || !content) {
      res.status(400).json({ error: 'date and content are required' });
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const now = new Date().toISOString();

    // Upsert by agent + date
    const existing = await db.select().from(dailyNotes)
      .where(and(eq(dailyNotes.agentId, agentId), eq(dailyNotes.date, date)));

    if (existing.length > 0) {
      const [updated] = await db.update(dailyNotes)
        .set({ content, updatedAt: now })
        .where(eq(dailyNotes.id, existing[0].id))
        .returning();
      res.json({ data: updated });
    } else {
      const [created] = await db.insert(dailyNotes).values({
        id: uuidv4(),
        agentId,
        organizationId: agent.organizationId || null,
        date,
        content,
        createdAt: now,
        updatedAt: now,
      }).returning();
      res.status(201).json({ data: created });
    }
  } catch (err: any) {
    console.error('[Memory] POST /daily-notes error:', err);
    res.status(500).json({ error: 'Failed to save daily note' });
  }
});

// DELETE /api/agents/:id/daily-notes/:date — delete note
router.delete('/daily-notes/:date', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const date = req.params.date;

    const existing = await db.select().from(dailyNotes)
      .where(and(eq(dailyNotes.agentId, agentId), eq(dailyNotes.date, date)));

    if (existing.length === 0) {
      res.status(404).json({ error: 'Daily note not found' });
      return;
    }

    await db.delete(dailyNotes).where(eq(dailyNotes.id, existing[0].id));
    res.json({ message: 'Daily note deleted' });
  } catch (err: any) {
    console.error('[Memory] DELETE /daily-notes/:date error:', err);
    res.status(500).json({ error: 'Failed to delete daily note' });
  }
});

// ─── Knowledge Base (agent-level) ─────────────────────────────────────────────

// GET /api/agents/:id/knowledge — list all knowledge entries for agent
router.get('/knowledge', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const entries = await db.select().from(knowledgeBase).where(eq(knowledgeBase.agentId, agentId));
    res.json({ data: entries, total: entries.length });
  } catch (err: any) {
    console.error('[Memory] GET /knowledge error:', err);
    res.status(500).json({ error: 'Failed to fetch knowledge entries' });
  }
});

// POST /api/agents/:id/knowledge — create knowledge entry
router.post('/knowledge', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const { category, title, content } = req.body;

    if (!category || !title || !content) {
      res.status(400).json({ error: 'category, title, and content are required' });
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const now = new Date().toISOString();
    const [created] = await db.insert(knowledgeBase).values({
      id: uuidv4(),
      agentId,
      organizationId: agent.organizationId || null,
      category,
      title,
      content,
      createdAt: now,
      updatedAt: now,
    }).returning();

    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error('[Memory] POST /knowledge error:', err);
    res.status(500).json({ error: 'Failed to create knowledge entry' });
  }
});

// PUT /api/agents/:id/knowledge/:knowledgeId — update knowledge entry
router.put('/knowledge/:knowledgeId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const knowledgeId = req.params.knowledgeId;
    const { category, title, content } = req.body;

    const [existing] = await db.select().from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeId), eq(knowledgeBase.agentId, agentId)));

    if (!existing) {
      res.status(404).json({ error: 'Knowledge entry not found' });
      return;
    }

    const now = new Date().toISOString();
    const updateData: Record<string, any> = { updatedAt: now };
    if (category !== undefined) updateData.category = category;
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;

    const [updated] = await db.update(knowledgeBase)
      .set(updateData)
      .where(eq(knowledgeBase.id, knowledgeId))
      .returning();

    res.json({ data: updated });
  } catch (err: any) {
    console.error('[Memory] PUT /knowledge/:knowledgeId error:', err);
    res.status(500).json({ error: 'Failed to update knowledge entry' });
  }
});

// DELETE /api/agents/:id/knowledge/:knowledgeId — delete knowledge entry
router.delete('/knowledge/:knowledgeId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const knowledgeId = req.params.knowledgeId;

    const [existing] = await db.select().from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, knowledgeId), eq(knowledgeBase.agentId, agentId)));

    if (!existing) {
      res.status(404).json({ error: 'Knowledge entry not found' });
      return;
    }

    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, knowledgeId));
    res.json({ message: 'Knowledge entry deleted' });
  } catch (err: any) {
    console.error('[Memory] DELETE /knowledge/:knowledgeId error:', err);
    res.status(500).json({ error: 'Failed to delete knowledge entry' });
  }
});

// ─── Tacit Knowledge ──────────────────────────────────────────────────────────

// GET /api/agents/:id/tacit — list all tacit knowledge for agent
router.get('/tacit', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const entries = await db.select().from(tacitKnowledge).where(eq(tacitKnowledge.agentId, agentId));
    res.json({ data: entries, total: entries.length });
  } catch (err: any) {
    console.error('[Memory] GET /tacit error:', err);
    res.status(500).json({ error: 'Failed to fetch tacit knowledge' });
  }
});

// POST /api/agents/:id/tacit — create tacit knowledge
router.post('/tacit', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const { topic, insight, confidence } = req.body;

    if (!topic || !insight) {
      res.status(400).json({ error: 'topic and insight are required' });
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const now = new Date().toISOString();
    const [created] = await db.insert(tacitKnowledge).values({
      id: uuidv4(),
      agentId,
      topic,
      insight,
      confidence: confidence !== undefined ? confidence : 0.5,
      createdAt: now,
      updatedAt: now,
    }).returning();

    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error('[Memory] POST /tacit error:', err);
    res.status(500).json({ error: 'Failed to create tacit knowledge' });
  }
});

// PUT /api/agents/:id/tacit/:tacitId — update tacit knowledge
router.put('/tacit/:tacitId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const tacitId = req.params.tacitId;
    const { topic, insight, confidence } = req.body;

    const [existing] = await db.select().from(tacitKnowledge)
      .where(and(eq(tacitKnowledge.id, tacitId), eq(tacitKnowledge.agentId, agentId)));

    if (!existing) {
      res.status(404).json({ error: 'Tacit knowledge entry not found' });
      return;
    }

    const now = new Date().toISOString();
    const updateData: Record<string, any> = { updatedAt: now };
    if (topic !== undefined) updateData.topic = topic;
    if (insight !== undefined) updateData.insight = insight;
    if (confidence !== undefined) updateData.confidence = confidence;

    const [updated] = await db.update(tacitKnowledge)
      .set(updateData)
      .where(eq(tacitKnowledge.id, tacitId))
      .returning();

    res.json({ data: updated });
  } catch (err: any) {
    console.error('[Memory] PUT /tacit/:tacitId error:', err);
    res.status(500).json({ error: 'Failed to update tacit knowledge' });
  }
});

// DELETE /api/agents/:id/tacit/:tacitId — delete tacit knowledge
router.delete('/tacit/:tacitId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const tacitId = req.params.tacitId;

    const [existing] = await db.select().from(tacitKnowledge)
      .where(and(eq(tacitKnowledge.id, tacitId), eq(tacitKnowledge.agentId, agentId)));

    if (!existing) {
      res.status(404).json({ error: 'Tacit knowledge entry not found' });
      return;
    }

    await db.delete(tacitKnowledge).where(eq(tacitKnowledge.id, tacitId));
    res.json({ message: 'Tacit knowledge entry deleted' });
  } catch (err: any) {
    console.error('[Memory] DELETE /tacit/:tacitId error:', err);
    res.status(500).json({ error: 'Failed to delete tacit knowledge' });
  }
});

export default router;
