// server.js
// Minimal Express app for Railway deployment with sessions + demo auth APIs.
// No external DB required. Works out-of-the-box with in-memory store for demo.
// If you later add Postgres, you can swap in connect-pg-simple easily.

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');

// --- Config ---
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

const app = express();
// So secure cookies work behind Railway's proxy
app.set('trust proxy', 1);

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session: MemoryStore (demo). For production w/ scale, use a real store.
app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,                 // only secure cookies on HTTPS
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// --- Health check ---
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// --- Very small in-memory "user table" (demo only) ---
// Map<email, { email, name, password }>
const users = new Map();

// --- Auth APIs matching the front-end calls ---
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password required' });
  }
  if (users.has(email)) {
    return res.status(409).json({ ok: false, error: 'User already exists' });
  }
  // NOTE: For demo we store plain text. In real apps, hash your password.
  users.set(email, { name: name || '', email, password });
  req.session.user = { email, name: name || '' };
  return res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = users.get(email);
  if (!u || u.password !== password) {
    return res.status(401).json({ ok: false, error: 'Invalid email or password' });
  }
  req.session.user = { email: u.email, name: u.name || '' };
  return res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false });
  }
  return res.json({ ok: true, ...req.session.user });
});

// --- Static hosting ---
// Serve static assets from the current directory so index.html works without moving files.
app.use(express.static(__dirname));

// Root: serve index.html explicitly to be safe
app.get('/', (_req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.type('text').send('index.html not found.');
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`[server] up on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});
