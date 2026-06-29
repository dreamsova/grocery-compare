import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Returns { list, role } or null if no access
function canAccess(listId, userId) {
  const list = db.prepare('SELECT * FROM shopping_lists WHERE id = ?').get(listId);
  if (!list) return null;
  if (list.owner_id === userId) return { list, role: 'owner' };
  const collab = db.prepare(
    'SELECT role FROM list_collaborators WHERE list_id = ? AND user_id = ?'
  ).get(listId, userId);
  return collab ? { list, role: collab.role } : null;
}

// GET /api/lists
router.get('/', (req, res) => {
  const owned = db.prepare(
    'SELECT * FROM shopping_lists WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(req.user.userId);

  const shared = db.prepare(`
    SELECT sl.*, lc.role FROM shopping_lists sl
    JOIN list_collaborators lc ON sl.id = lc.list_id
    WHERE lc.user_id = ? ORDER BY sl.created_at DESC
  `).all(req.user.userId);

  res.json({ owned, shared });
});

// POST /api/lists
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const id = nanoid();
  db.prepare('INSERT INTO shopping_lists (id, name, owner_id, share_token) VALUES (?, ?, ?, ?)')
    .run(id, name.trim(), req.user.userId, nanoid(12));
  res.json(db.prepare('SELECT * FROM shopping_lists WHERE id = ?').get(id));
});

// GET /api/lists/:id
router.get('/:id', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  if (!access) return res.status(404).json({ error: 'List not found' });

  const items = db.prepare(`
    SELECT li.*,
      p.name AS product_name,
      p.image_url,
      p.walmart_url,
      p.instacart_url,
      (SELECT price FROM price_snapshots
       WHERE product_id = p.id AND store = 'kroger'
       ORDER BY scraped_at DESC LIMIT 1) AS kroger_price,
      (SELECT source_kind FROM price_snapshots
       WHERE product_id = p.id AND store = 'kroger'
       ORDER BY scraped_at DESC LIMIT 1) AS kroger_source_kind,
      (SELECT confidence FROM price_snapshots
       WHERE product_id = p.id AND store = 'kroger'
       ORDER BY scraped_at DESC LIMIT 1) AS kroger_confidence,
      (SELECT price FROM price_snapshots
       WHERE product_id = p.id AND store = 'walmart'
       ORDER BY scraped_at DESC LIMIT 1) AS walmart_price,
      (SELECT price FROM price_snapshots
       WHERE product_id = p.id AND store = 'instacart'
       ORDER BY scraped_at DESC LIMIT 1) AS instacart_price,
      (SELECT price FROM price_snapshots
       WHERE product_id = p.id
         AND store IN ('manual', 'aldi', 'costco', 'trader_joes')
       ORDER BY scraped_at DESC LIMIT 1) AS community_price,
      (SELECT store FROM price_snapshots
       WHERE product_id = p.id
         AND store IN ('manual', 'aldi', 'costco', 'trader_joes')
       ORDER BY scraped_at DESC LIMIT 1) AS community_store,
      (SELECT source_label FROM price_snapshots
       WHERE product_id = p.id
         AND store IN ('manual', 'aldi', 'costco', 'trader_joes')
       ORDER BY scraped_at DESC LIMIT 1) AS community_source_label,
      (SELECT source_kind FROM price_snapshots
       WHERE product_id = p.id
         AND store IN ('manual', 'aldi', 'costco', 'trader_joes')
       ORDER BY scraped_at DESC LIMIT 1) AS community_source_kind,
      (SELECT confidence FROM price_snapshots
       WHERE product_id = p.id
         AND store IN ('manual', 'aldi', 'costco', 'trader_joes')
       ORDER BY scraped_at DESC LIMIT 1) AS community_confidence,
      (SELECT evidence_note FROM price_snapshots
       WHERE product_id = p.id
         AND store IN ('manual', 'aldi', 'costco', 'trader_joes')
       ORDER BY scraped_at DESC LIMIT 1) AS community_evidence_note,
      (SELECT scraped_at FROM price_snapshots
       WHERE product_id = p.id
       ORDER BY scraped_at DESC LIMIT 1) AS last_updated
    FROM list_items li
    JOIN products p ON li.product_id = p.id
    WHERE li.list_id = ?
    ORDER BY li.position, li.created_at
  `).all(req.params.id);

  const collaborators = db.prepare(`
    SELECT u.id, u.display_name, u.email, lc.role
    FROM users u JOIN list_collaborators lc ON u.id = lc.user_id
    WHERE lc.list_id = ?
  `).all(req.params.id);

  res.json({ ...access.list, role: access.role, items, collaborators });
});

// PATCH /api/lists/:id
router.patch('/:id', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  if (!access || access.role !== 'owner') return res.status(403).json({ error: 'Not authorized' });
  const { name } = req.body;
  if (name?.trim()) {
    db.prepare('UPDATE shopping_lists SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  }
  res.json(db.prepare('SELECT * FROM shopping_lists WHERE id = ?').get(req.params.id));
});

// DELETE /api/lists/:id
router.delete('/:id', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  if (!access || access.role !== 'owner') return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM shopping_lists WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/lists/:id/join  (via share token)
router.post('/:id/join', (req, res) => {
  const { share_token } = req.body;
  const list = db.prepare(
    'SELECT * FROM shopping_lists WHERE id = ? AND share_token = ?'
  ).get(req.params.id, share_token);
  if (!list) return res.status(404).json({ error: 'Invalid share link' });
  if (list.owner_id === req.user.userId) return res.status(400).json({ error: 'You own this list' });

  db.prepare('INSERT OR IGNORE INTO list_collaborators (list_id, user_id) VALUES (?, ?)')
    .run(req.params.id, req.user.userId);
  res.json({ ok: true, list });
});

// POST /api/lists/:id/invite  (by email)
router.post('/:id/invite', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  if (!access || access.role !== 'owner') return res.status(403).json({ error: 'Not authorized' });

  const { email, role = 'editor' } = req.body;
  const invitee = db.prepare('SELECT id FROM users WHERE email = ?').get(email?.toLowerCase());
  if (!invitee) return res.status(404).json({ error: 'No account found with that email' });
  if (invitee.id === req.user.userId) return res.status(400).json({ error: 'Cannot invite yourself' });

  db.prepare('INSERT OR REPLACE INTO list_collaborators (list_id, user_id, role) VALUES (?, ?, ?)')
    .run(req.params.id, invitee.id, role);
  res.json({ ok: true });
});

// DELETE /api/lists/:id/collaborators/:userId
router.delete('/:id/collaborators/:userId', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  const isSelf = req.params.userId === req.user.userId;
  if (!access || (access.role !== 'owner' && !isSelf)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare('DELETE FROM list_collaborators WHERE list_id = ? AND user_id = ?')
    .run(req.params.id, req.params.userId);
  res.json({ ok: true });
});

// POST /api/lists/:id/items
router.post('/:id/items', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  if (!access || access.role === 'viewer') return res.status(403).json({ error: 'Not authorized' });

  const { product_id, quantity = 1, store_choice, notes } = req.body;
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const id = nanoid();
  const maxPos = db.prepare('SELECT MAX(position) as m FROM list_items WHERE list_id = ?').get(req.params.id);
  db.prepare(`INSERT INTO list_items
    (id, list_id, product_id, quantity, added_by, store_choice, notes, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.params.id, product_id, quantity, req.user.userId, store_choice ?? null, notes ?? null, (maxPos?.m ?? -1) + 1);

  res.json(db.prepare(`
    SELECT li.*, p.name AS product_name, p.image_url FROM list_items li
    JOIN products p ON li.product_id = p.id WHERE li.id = ?
  `).get(id));
});

// PATCH /api/lists/:id/items/:itemId
router.patch('/:id/items/:itemId', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  if (!access || access.role === 'viewer') return res.status(403).json({ error: 'Not authorized' });

  const { checked, quantity, notes, store_choice, position } = req.body;
  db.prepare(`UPDATE list_items SET
    checked = COALESCE(?, checked),
    quantity = COALESCE(?, quantity),
    notes = COALESCE(?, notes),
    store_choice = COALESCE(?, store_choice),
    position = COALESCE(?, position),
    updated_at = datetime('now')
    WHERE id = ? AND list_id = ?`).run(
    checked !== undefined ? (checked ? 1 : 0) : null,
    quantity ?? null, notes ?? null, store_choice ?? null, position ?? null,
    req.params.itemId, req.params.id,
  );

  res.json(db.prepare('SELECT * FROM list_items WHERE id = ?').get(req.params.itemId));
});

// DELETE /api/lists/:id/items/:itemId
router.delete('/:id/items/:itemId', (req, res) => {
  const access = canAccess(req.params.id, req.user.userId);
  if (!access || access.role === 'viewer') return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM list_items WHERE id = ? AND list_id = ?').run(req.params.itemId, req.params.id);
  res.json({ ok: true });
});

export default router;
