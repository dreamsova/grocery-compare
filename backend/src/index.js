import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRouter from './routes/auth.js';
import listsRouter from './routes/lists.js';
import productsRouter from './routes/products.js';
import compareRouter from './routes/compare.js';
import browseRouter from './routes/browse.js';
import sourcesRouter from './routes/sources.js';
import systemRouter from './routes/system.js';
import { seedDemoData } from '../scripts/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : [];
const corsOptions = {
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
};

const io = new Server(httpServer, {
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Serve frontend
app.use(express.static(join(__dirname, '..', 'public')));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/lists', listsRouter);
app.use('/api/products', productsRouter);
app.use('/api/compare', compareRouter);
app.use('/api/browse', browseRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/system', systemRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Fallback: serve index.html for any non-API route (SPA routing)
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Socket.IO ────────────────────────────────────────────────────────────────
// Authenticate on connection
io.use((socket, next) => {
  const cookies = parseCookieHeader(socket.handshake.headers.cookie);
  const token = socket.handshake.auth?.token || cookies.access_token;
  if (!token) return next(new Error('Not authenticated'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

function parseCookieHeader(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) return cookies;
    cookies[rawKey] = decodeURIComponent(rawValue.join('=') || '');
    return cookies;
  }, {});
}

io.on('connection', (socket) => {
  socket.on('join_list', (listId) => socket.join(`list:${listId}`));
  socket.on('leave_list', (listId) => socket.leave(`list:${listId}`));

  // Relay real-time events to all other members of the list room
  socket.on('item_update', ({ list_id, item_id, changes }) => {
    socket.to(`list:${list_id}`).emit('item_updated', {
      item_id, changes, by: socket.user.userId,
    });
  });
  socket.on('item_added', ({ list_id, item }) => {
    socket.to(`list:${list_id}`).emit('item_added', { item, by: socket.user.userId });
  });
  socket.on('item_removed', ({ list_id, item_id }) => {
    socket.to(`list:${list_id}`).emit('item_removed', { item_id, by: socket.user.userId });
  });
});

export { io };

const PORT = process.env.PORT || 3001;

if (process.env.SEED_DEMO_DATA === 'true') {
  await seedDemoData();
}

httpServer.listen(PORT, () => {
  console.log(`\n  Grocery Compare running at http://localhost:${PORT}\n`);
});
