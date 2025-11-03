/**
 * FunX / Juice Game Server — PostgreSQL edition (Railway ready)
 * - 依赖环境变量：DATABASE_URL, ADMIN_KEY, SESSION_SECRET
 * - 可选：SENDGRID_API_KEY, MAIL_FROM（群发邮件）
 * - API: /api/register  /api/login  /api/me  /api/logout  /api/games  /play/:id
 * - Admin: /admin/users.json  /admin/export-users.csv  /admin/send-email  /admin/dbcheck
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
let sgMail = null;

const app = express();
const PORT = process.env.PORT || 8080;

/* ------------------------ PostgreSQL ------------------------ */
if (!process.env.DATABASE_URL) {
  console.warn('[WARN] DATABASE_URL is not set. Please add it in Railway -> Variables.');
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
async function q(text, params) { return pool.query(text, params); }

// 启动时自动建表（幂等）
async function initDB() {
  await q(`
    CREATE TABLE IF NOT EXISTS public.users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      coins INTEGER NOT NULL DEFAULT 0,
      verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON public.users (lower(email));`);
}

// 打印当前连接指纹（不含密码）
(function logDB() {
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/^postgres(?:ql)?:\/\/([^@]+)@([^/:]+)(?::(\d+))?\/([^?]+)/i);
  if (m) {
    console.log('[DB] host=%s port=%s db=%s user=%s', m[2], m[3] || '5432', m[4], (m[1]||'').split(':')[0]);
  }
})();

/* ------------------------ Common ------------------------ */
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/games', express.static(path.join(__dirname, 'games')));
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2024',
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

function sendIndex(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
}
app.get('/', sendIndex);
app.get('/login', sendIndex);
app.get('/register', sendIndex);

function requireAdmin(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== (process.env.ADMIN_KEY || '')) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

function ensureSendGrid() {
  if (!sgMail) {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
  }
}

/* ------------------------ Users API ------------------------ */
app.get('/api/me', (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, user: null });
  res.json({ ok: true, user: u });
});

app.post('/api/register', async (req, res) => {
  try {
    const { name = '', email = '', password = '' } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password are required.' });
    }
    const exists = await q(`SELECT id FROM public.users WHERE lower(email)=lower($1)`, [email]);
    if (exists.rowCount) return res.status(409).json({ ok: false, error: 'Email already registered.' });

    const hash = await bcrypt.hash(String(password), 10);
    const r = await q(
      `INSERT INTO public.users (name,email,password_hash)
       VALUES ($1,$2,$3)
       RETURNING id,name,email,level,coins,verified,created_at`,
      [name || email.split('@')[0], email, hash]
    );
    const user = r.rows[0];
    req.session.user = user;
    res.json({ ok: true, redirect: '/' });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    const r = await q(
      `SELECT id,name,email,password_hash,level,coins,verified
         FROM public.users WHERE lower(email)=lower($1)`,
      [email]
    );
    if (!r.rowCount) return res.status(401).json({ ok: false, error: 'Invalid email or password.' });
    const row = r.rows[0];
    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Invalid email or password.' });

    const user = { id: row.id, name: row.name, email: row.email, level: row.level, coins: row.coins, verified: row.verified };
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

/* ------------------------ Games scanning ------------------------ */
let games = new Map();

function stableIdFromFolder(folder) {
  const s = String(folder);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function loadGames() {
  const map = new Map();
  const gamesDir = path.join(__dirname, 'games');
  if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, { recursive: true });
    games = map; return;
  }
  const folders = fs
    .readdirSync(gamesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b));

  folders.forEach(folder => {
    const id = stableIdFromFolder(folder);
    const dir = path.join(gamesDir, folder);

    let meta = {};
    const metaFile = path.join(dir, 'game.json');
    if (fs.existsSync(metaFile)) {
      try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
      catch (e) { console.warn(`⚠️ Failed to parse ${path.join('games', folder, 'game.json')}:`, e.message); }
    }

    let entryFile = meta.entryFile || null;
    const candidates = ['index.html', 'game.html', 'main.html', `${folder}.html`];
    if (!entryFile) {
      const picked = candidates.find(f => fs.existsSync(path.join(dir, f)));
      if (picked) entryFile = picked;
    }
    if (!entryFile) {
      const anyHtml = fs.readdirSync(dir).find(f => /\.html?$/i.test(f)) || null;
      if (anyHtml) entryFile = anyHtml;
    }
    if (!entryFile) { console.warn(`⚠️ Skip ${folder}: no HTML entry found`); return; }

    const displayName = (meta.name && String(meta.name).trim())
      ? String(meta.name).trim()
      : folder.replace(/[-_]/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

    const cfg = {
      id, folder,
      name: displayName,
      description: meta.description || `A fun game: ${displayName}`,
      icon: meta.icon || '🎮',
      category: meta.category || 'General',
      difficulty: meta.difficulty || 'medium',
      entryFile
    };
    map.set(id, cfg);
  });

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
  if (!game) { console.warn(`❌ /play/${gameId}: game not found`); return res.redirect('/'); }

  const dir = path.join(__dirname, 'games', game.folder);
  const file = path.join(dir, game.entryFile);
  if (fs.existsSync(file)) return res.sendFile(file);
  console.warn(`❌ Missing entry file: ${path.relative(__dirname, file)} — fallback to static path`);
  if (fs.existsSync(dir)) return res.redirect(`/games/${encodeURIComponent(game.folder)}/${encodeURIComponent(game.entryFile)}`);
  return res.status(404).send('Game not found');
});

/* ------------------------ Admin ------------------------ */
// 导出 JSON（查看注册用户）
app.get('/admin/users.json', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const r = await q(`SELECT id,name,email,level,coins,verified,created_at FROM public.users ORDER BY id DESC`);
  res.json({ ok: true, count: r.rowCount, users: r.rows });
});

// 导出 CSV
app.get('/admin/export-users.csv', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const r = await q(`SELECT name,email,level,coins,verified,created_at FROM public.users ORDER BY created_at DESC`);
  const header = 'name,email,level,coins,verified,created_at';
  const lines = r.rows.map(row => [
    (row.name || '').replace(/"/g, '""'),
    (row.email || '').replace(/"/g, '""'),
    row.level ?? 1,
    row.coins ?? 0,
    row.verified ? 1 : 0,
    row.created_at?.toISOString?.() || row.created_at || ''
  ].map(x => `"${x}"`).join(','));
  const csv = [header, ...lines].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
  res.send(csv);
});

// 群发邮件
app.post('/admin/send-email', express.json({limit:'200kb'}), async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!process.env.SENDGRID_API_KEY) {
    return res.status(400).json({ ok: false, error: 'SENDGRID_API_KEY not set' });
  }
  ensureSendGrid();

  const { subject = '', html = '', filter = 'all' } = req.body || {};
  if (!subject || !html) return res.status(400).json({ ok: false, error: 'subject and html are required' });

  let sql = `SELECT email FROM public.users`;
  if (filter === 'verified') sql += ` WHERE verified=true`;
  const r = await q(sql);
  const emails = r.rows.map(x => x.email).filter(Boolean);
  if (!emails.length) return res.json({ ok: false, sent: 0, error: 'no recipients' });

  try {
    await sgMail.sendMultiple({
      to: emails,
      from: process.env.MAIL_FROM || 'no-reply@example.com',
      subject, html
    });
    res.json({ ok: true, sent: emails.length });
  } catch (e) {
    console.error('SendGrid error:', e?.response?.body || e);
    res.status(500).json({ ok: false, error: 'send failed' });
  }
});

// DB 自检（指纹+计数）
app.get('/admin/dbcheck', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const info = await q(`select current_database() db, current_user "user",
                          current_schema schema, inet_server_addr() ip, inet_server_port() port`);
    const cnt1 = await q(`select count(*)::int n from public.users`);
    res.json({ ok: true, ...info.rows[0], user_count: cnt1.rows[0].n });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});

/* ------------------------ Health & Start ------------------------ */
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, async () => {
  await initDB();
  console.log(`Server listening on :${PORT}`);
});

// 添加数据库连接测试端点
app.get('/api/db-status', async (req, res) => {
  try {
    const result = await q('SELECT NOW() as time, version() as version');
    const userCount = await q('SELECT COUNT(*)::int as count FROM public.users');
    
    res.json({ 
      ok: true, 
      database: 'connected',
      currentTime: result.rows[0].time,
      version: result.rows[0].version,
      userCount: userCount.rows[0].count
    });
  } catch (error) {
    console.error('Database status check failed:', error);
    res.status(500).json({ 
      ok: false, 
      database: 'disconnected',
      error: error.message 
    });
  }
});
