// server.js —— add working auth + correct routing
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

const app = express();
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- Postgres session (optional) ----------
let pool = null;
if (DATABASE_URL) pool = new Pool({ connectionString: DATABASE_URL });

let StoreCtor = null;
try {
  StoreCtor = require('connect-pg-simple')(session);
} catch (e) {
  console.log('[SESSION] connect-pg-simple not installed, using MemoryStore (DEV ONLY)');
}

// cookie secure only in prod
const isProd = process.env.NODE_ENV === 'production';

app.use(session({
  store: (StoreCtor && pool) ? new StoreCtor({
    pool,
    tableName: 'session'
  }) : undefined,
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,   // ✅ only https env
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// ---------- Simple in-memory user store (demo) ----------
const users = new Map();

// ---------- API routes (must come BEFORE static) ----------
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok:false, error:'Email & password required' });
  }
  if (users.has(email)) {
    return res.status(409).json({ ok:false, error:'User already exists' });
  }
  users.set(email, { name:name||'', email, password });
  req.session.user = { email, name:name||'' };
  res.json({ ok:true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = users.get(email);
  if (!u || u.password !== password) {
    return res.status(401).json({ ok:false, error:'Invalid credentials' });
  }
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

// ---------- static files ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- SPA fallback (only GET) ----------
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- boot ----------
app.listen(PORT, () => {
  console.log(`✅ Server running on :${PORT}`);
  if (!DATABASE_URL) console.log('⚠️ No DATABASE_URL, using memory for users');
});
