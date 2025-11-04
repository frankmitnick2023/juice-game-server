// server.js — with games directory scanning & listing
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- Optional: Postgres session store ----------
let pool = null;
if (DATABASE_URL) pool = new Pool({ connectionString: DATABASE_URL });

let StoreCtor = null;
try {
  StoreCtor = require('connect-pg-simple')(session);
} catch {
  console.log('[SESSION] connect-pg-simple not installed, using MemoryStore (DEV ONLY)');
}

app.use(session({
  store: (StoreCtor && pool) ? new StoreCtor({ pool, tableName: 'session' }) : undefined,
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// ---------- Minimal demo users (in-memory) ----------
const users = new Map();

app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:'Email & password required' });
  if (users.has(email)) return res.status(409).json({ ok:false, error:'User already exists' });
  users.set(email, { name:name||'', email, password });
  req.session.user = { email, name:name||'' };
  res.json({ ok:true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = users.get(email);
  if (!u || u.password !== password) return res.status(401).json({ ok:false, error:'Invalid credentials' });
  req.session.user = { email: u.email, name: u.name };
  res.json({ ok:true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok:true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok:false });
  res.json({ ok:true, ...req.session.user });
});

app.get('/healthz', (_req, res) => res.json({ ok:true }));

// ---------- Games scanning ----------
// Conventions supported:
// 1) ./games/<slug>/index.html   (recommended)
// 2) ./games/*.html              (single-file games in root)
const GAMES_DIR = path.join(__dirname, 'games');

function findGames() {
  const results = [];
  if (!fs.existsSync(GAMES_DIR)) return results;

  // 2) html files in /games root
  const rootEntries = fs.readdirSync(GAMES_DIR, { withFileTypes: true });
  for (const ent of rootEntries) {
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.html')) {
      const slug = ent.name.replace(/\.html$/i, '');
      results.push({
        id: slug,
        title: slug,
        url: `/games/${ent.name}`,
        type: 'file'
      });
    }
  }

  // 1) folders with index.html
  for (const ent of rootEntries) {
    if (ent.isDirectory()) {
      const idx = path.join(GAMES_DIR, ent.name, 'index.html');
      if (fs.existsSync(idx)) {
        results.push({
          id: ent.name,
          title: ent.name,
          url: `/games/${ent.name}/`,
          type: 'folder'
        });
      }
    }
  }

  // sort by id for stability
  results.sort((a,b) => a.id.localeCompare(b.id));
  return results;
}

// List games as JSON
app.get('/api/games', (_req, res) => {
  try {
    const games = findGames();
    res.json({ ok:true, games });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ---------- Static hosting ----------
// Serve public UI
app.use(express.static(path.join(__dirname, 'public')));
// Serve games assets (JS, images, etc.)
app.use('/games', express.static(GAMES_DIR, { fallthrough: false }));

// SPA fallback for non-API routes (kept after static)
app.get(/^\/(?!api)(?!games)(?!healthz).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on :${PORT}`);
  console.log(`[games] directory: ${GAMES_DIR}`);
});
