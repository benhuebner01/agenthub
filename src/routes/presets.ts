import { Router, Request, Response } from 'express';
import { AGENT_PRESETS } from '../data/presets';

const router = Router();

// GET /api/presets — return all presets
router.get('/', (req: Request, res: Response) => {
  res.json({ data: AGENT_PRESETS, total: AGENT_PRESETS.length });
});

// GET /api/presets/:id — return single preset
router.get('/:id', (req: Request, res: Response) => {
  const preset = AGENT_PRESETS.find((p) => p.id === req.params.id);
  if (!preset) {
    res.status(404).json({ error: `Preset "${req.params.id}" not found` });
    return;
  }
  res.json({ data: preset });
});

export default router;
