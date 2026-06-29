import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function createTokens(userId) {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = nanoid(64);
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(nanoid(), userId, tokenHash, expiresAt);
  return { accessToken, refreshToken };
}

function setCookies(res, accessToken, refreshToken) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('access_token', accessToken, {
    httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true, secure: isProd, sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, path: '/api/auth',
  });
}

router.post('/register', (req, res) => {
  const { email, password, display_name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = nanoid();
  const hash = bcrypt.hashSync(password, 12);
  const name = display_name?.trim() || email.split('@')[0];
  db.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
    .run(id, email.toLowerCase(), hash, name);

  const { accessToken, refreshToken } = createTokens(id);
  setCookies(res, accessToken, refreshToken);
  res.json({ id, email: email.toLowerCase(), display_name: name, ic_plus: false, wm_plus: false });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email?.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const { accessToken, refreshToken } = createTokens(user.id);
  setCookies(res, accessToken, refreshToken);
  res.json({
    id: user.id, email: user.email, display_name: user.display_name,
    ic_plus: !!user.ic_plus, wm_plus: !!user.wm_plus,
  });
});

router.post('/logout', (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (rt) {
    const hash = crypto.createHash('sha256').update(rt).digest('hex');
    db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hash);
  }
  res.clearCookie('access_token');
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.json({ ok: true });
});

router.post('/refresh', (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (!rt) return res.status(401).json({ error: 'No refresh token' });

  const hash = crypto.createHash('sha256').update(rt).digest('hex');
  const stored = db.prepare(
    `SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime('now')`
  ).get(hash);
  if (!stored) return res.status(401).json({ error: 'Refresh token expired' });

  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(stored.id);
  const { accessToken, refreshToken } = createTokens(stored.user_id);
  setCookies(res, accessToken, refreshToken);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, display_name, ic_plus, wm_plus FROM users WHERE id = ?')
    .get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ...user, ic_plus: !!user.ic_plus, wm_plus: !!user.wm_plus });
});

router.patch('/me', requireAuth, (req, res) => {
  const { display_name, ic_plus, wm_plus } = req.body;
  db.prepare(`UPDATE users SET
    display_name = COALESCE(?, display_name),
    ic_plus = COALESCE(?, ic_plus),
    wm_plus = COALESCE(?, wm_plus)
    WHERE id = ?`).run(
    display_name ?? null,
    ic_plus !== undefined ? (ic_plus ? 1 : 0) : null,
    wm_plus !== undefined ? (wm_plus ? 1 : 0) : null,
    req.user.userId,
  );
  const user = db.prepare('SELECT id, email, display_name, ic_plus, wm_plus FROM users WHERE id = ?')
    .get(req.user.userId);
  res.json({ ...user, ic_plus: !!user.ic_plus, wm_plus: !!user.wm_plus });
});

export default router;
