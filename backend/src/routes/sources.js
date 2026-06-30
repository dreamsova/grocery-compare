import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dataSourceCatalog, enrichQueryFromSources } from '../dataSources/index.js';

const router = Router();
router.use(requireAuth);

router.get('/', (_req, res) => {
  res.json(dataSourceCatalog().map(source => ({
    id: source.id,
    label: source.label,
    kind: source.kind,
    role: source.role,
    trust: source.trust,
    requiresKey: source.requiresKey,
    configured: source.configured,
    credentialMode: source.credentialMode || null,
  })));
});

router.get('/search', async (req, res) => {
  const query = req.query.q?.trim();
  if (!query) return res.status(400).json({ error: 'q required' });

  const enrichment = await enrichQueryFromSources(query, { limit: req.query.limit || 3 });
  res.json(enrichment);
});

export default router;
