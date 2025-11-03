/**
 * Juice Game Server — PostgreSQL Edition
 * - 使用 pg 模块，连接 Railway PostgreSQL（持久化）
 * - 本地开发支持 .env.local 覆盖 DATABASE_URL
 * - 所有 API 完全兼容原 sql.js 版本
 * - 重新部署不会丢失用户数据
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// --------------------- PostgreSQL Pool ---------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/juice_game',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 启动时确保表存在
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        name          TEXT,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        level         INTEGER NOT NULL DEFAULT 1,
        coins         INTEGER NOT NULL DEFAULT 0,
        verified      INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('PostgreSQL table "users" ready');
  } catch (err) {
    console.error('Failed to create users table:', err.message);
  }
})();

// --------------------- Helpers ---------------------
function requireAdmin(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== (process.env.ADMIN_KEY || '')) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

let sgMail = null;
function ensureSendGrid() {
  if (!sgMail && process.env.SENDGRID_API_KEY) {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }
}

// --------------------- Express Setup ---------------------
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: 'auto',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Static files
app.use('/games', express.static(path.join(__dirname, 'games')));
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// SPA entry
function sendIndex(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
}
app.get('/', sendIndex);
app.get('/login', sendIndex);
app.get('/register', sendIndex);

// --------------------- Admin: DB Check ---------------------
app.get('/admin/dbcheck', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const info = await pool.query(`
      SELECT 
        current_database() AS db,
        current_user AS "user",
        current_schema() AS schema,
        inet_server_addr() AS ip,
        inet_server_port() AS port
    `);
    const tables = await pool.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = 'users'
    `);
    let userCount = 0;
    try {
      const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM users');
      userCount = cnt.rows[0].n;
    } catch (e) {
      console.error('Count users failed:', e);
    }

    res.json({
      ok: true,
      connection: info.rows[0],
      users_table_found: tables.rows,
      user_count: userCount
    });
  } catch (e) {
    console.error('dbcheck error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --------------------- Admin: Export Users ---------------------
app.get('/admin/users.json', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await pool.query(`
      SELECT id, name, email, level, coins, verified, created_at 
      FROM users 
      ORDER BY id DESC
    `);
    res.json({ ok: true, count: result.rows.length, users: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/admin/export-users.csv', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await pool.query(`
      SELECT name, email, level, coins, verified, created_at 
      FROM users 
      ORDER BY created_at DESC
    `);
    const header = 'name,email,level,coins,verified,created_at';
    const lines = result.rows.map(r => [
      (r.name || '').replace(/"/g, '""'),
      r.email.replace(/"/g, '""'),
      r.level,
      r.coins,
      r.verified,
      r.created_at
    ].map(x => `"${x}"`).join(','));
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --------------------- Admin: Send Email ---------------------
app.post('/admin/send-email', express.json({ limit: '200kb' }), async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!process.env.SENDGRID_API_KEY) {
    return res.status(400).json({ ok: false, error: 'SENDGRID_API_KEY not set' });
  }
  ensureSendGrid();

  const { subject = '', html = '', filter = 'all' } = req.body;
  if (!subject || !html) {
    return res.status(400).json({ ok: false, error: 'subject and html required' });
  }

  let query = 'SELECT email FROM users';
  if (filter === 'verified') query += ' WHERE verified = 1';

  try {
    const result = await pool.query(query);
    const emails = result.rows.map(r => r.email).filter(Boolean);
    if (!emails.length) return res.json({ ok: true, sent: 0, note: 'no recipients' });

    const msg = {
      to: emails,
      from: process.env.MAIL_FROM || 'no-reply@juicegame.co',
      subject,
      html
    };
    await sgMail.sendMultiple(msg);
    res.json({ ok: true, sent: emails.length });
  } catch (e) {
    console.error('SendGrid error:', e?.response?.body || e);
    res.status(500).json({ ok: false, error: 'send failed' });
  }
});

// --------------------- User API ---------------------
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, user: null });
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/register', async (req, res) => {
  const { name = '', email = '', password = '' } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password required' });
  }

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ ok: false, error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const result = await pool.query(`
      INSERT INTO users (name, email, password_hash) 
      VALUES ($1, $2, $3) 
      RETURNING id, name, email, level, coins, verified
    `, [name || email.split('@')[0], email, hash]);

    const user = result.rows[0];
    req.session.user = user;
    res.json({ ok: true, redirect: '/' });
  } catch (e) {
    console.error('Register error:', e);
    if (e.code === '23505') { // UNIQUE violation
      return res.status(409).json({ ok: false, error: 'Email already registered' });
    }
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  try {
    const result = await pool.query(`
      SELECT id, name, email, password_hash, level, coins, verified 
      FROM users 
      WHERE lower(email) = lower($1)
    `, [email]);

    const row = result.rows[0];
    if (!row) return res.status(401).json({ ok: false, error: 'Invalid email or password' });

    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Invalid email or password' });

    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      level: row.level,
      coins: row.coins,
      verified: row.verified
    };
    req.session.user = user;
    res.json({ ok: true, redirect: '/' });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true, redirect: '/' }));
});

// --------------------- Games API ---------------------
let games = new Map();

function stableIdFromFolder(folder) {
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = ((h << 5) - h + folder.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function loadGames() {
  const map = new Map();
  const gamesDir = path.join(__dirname, 'games');
  if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, { recursive: true });
    games = map; return;
  }

  const folders = fs.readdirSync(gamesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const folder of folders) {
    const id = stableIdFromFolder(folder);
    const dir = path.join(gamesDir, folder);
    let meta = {};
    const metaFile = path.join(dir, 'game.json');
    if (fs.existsSync(metaFile)) {
      try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) {}
    }

    let entryFile = meta.entryFile;
    if (!entryFile) {
      const candidates = ['index.html', 'game.html', 'main.html', `${folder}.html`];
      entryFile = candidates.find(f => fs.existsSync(path.join(dir, f))) || null;
    }
    if (!entryFile) {
      const any = fs.readdirSync(dir).find(f => /\.html?$/i.test(f));
      if (any) entryFile = any;
    }
    if (!entryFile) continue;

    const displayName = meta.name?.trim() || folder.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    map.set(id, {
      id, folder, name: displayName, description: meta.description || `A fun game: ${displayName}`,
      icon: meta.icon || 'game', category: meta.category || 'General', difficulty: meta.difficulty || 'medium',
      entryFile
    });
  }
  games = map;
}
loadGames();

app.get('/api/games', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  loadGames();
  res.json({
    ok: true,
    items: Array.from(games.values()).map(g => ({
      id: g.id, name: g.name, description: g.description, icon: g.icon, category: g.category
    }))
  });
});

app.get('/play/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  loadGames();
  const gameId = parseInt(req.params.id, 10);
  const game = games.get(gameId);
  if (!game) return res.redirect('/');
  const file = path.join(__dirname, 'games', game.folder, game.entryFile);
  if (fs.existsSync(file)) return res.sendFile(file);
  return res.redirect(`/games/${encodeURIComponent(game.folder)}/${encodeURIComponent(game.entryFile)}`);
});

// --------------------- Health ---------------------
app.get('/healthz', (req, res) => res.json({ ok: true }));

// --------------------- Start Server ---------------------
app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
  console.log(`DB: ${process.env.DATABASE_URL ? 'Railway PostgreSQL' : 'Local DB'}`);
});