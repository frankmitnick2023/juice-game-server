/**
 * FunX / Juice Game Server — PostgreSQL + Session in PG (Railway)
 * ENV:
 *   DATABASE_URL (required)
 *   SESSION_SECRET (recommended)
 *   ADMIN_KEY (admin endpoints)
 *   SENDGRID_API_KEY, MAIL_FROM (optional for bulk email)
 */

const express = require('express');
const session = require('express-session');
// 用下面这段（加在 require 们下面）
let pgSessionFactory = null;
try {
  pgSessionFactory = require('connect-pg-simple')(session);
} catch (e) {
  console.warn('[SESSION] connect-pg-simple not installed, using MemoryStore (DEV ONLY)');
}

// 会话中使用（把你现有的 app.use(session({...})) 的 store 部分改成如下）:
const store = pgSessionFactory
  ? new pgSessionFactory({
      pool,
      tableName: 'user_sessions',
      schemaName: 'public',
      createTableIfMissing: true
    })
  : undefined; // 未安装则使用默认内存存储（开发用）

app.use(session({
  store,
  secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { secure: 'auto', sameSite: 'lax', httpOnly: true, maxAge: 24*60*60*1000 }
}));

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let sgMail = null;

const app = express();
const PORT = process.env.PORT || 8080;

/* ----------------------- ENV / DB ----------------------- */
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('[FATAL] Missing env: DATABASE_URL');
  process.exit(1);
}
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const q = (text, params) => pool.query(text, params);

(function logDB() {
  const m = DB_URL.match(/^postgres(?:ql)?:\/\/([^@]+)@([^/:]+)(?::(\d+))?\/([^?]+)/i);
  if (m) console.log('[DB] connected host=%s port=%s db=%s user=%s', m[2], m[3] || '5432', m[4], (m[1]||'').split(':')[0]);
})();

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
  console.log('[DB] schema ensured');
}

/* ----------------------- MIDDLEWARE ----------------------- */
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Sessions in Postgres (persist across restarts/scales)
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'user_sessions',
    schemaName: 'public',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { secure: 'auto', sameSite: 'lax', httpOnly: true, maxAge: 24*60*60*1000 }
}));

// Static
app.use('/games', express.static(path.join(__dirname, 'games')));
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}
function sendIndex(_req, res){ res.sendFile(path.join(__dirname, 'index.html')); }
app.get('/', sendIndex);
app.get('/login', sendIndex);
app.get('/register', sendIndex);

/* ----------------------- Helpers ----------------------- */
function requireAdmin(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== (process.env.ADMIN_KEY || '')) {
    res.status(403).json({ ok:false, error:'Forbidden' });
    return false;
  }
  return true;
}
function ensureSendGrid(){
  if (!sgMail) {
    sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
  }
}

/* ----------------------- Auth API ----------------------- */
app.get('/api/me', (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok:false, user:null });
  res.json({ ok:true, user:u });
});

app.post('/api/register', async (req, res) => {
  try{
    const { name='', email='', password='' } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok:false, error:'Email and password are required.' });
    const existed = await q(`SELECT 1 FROM public.users WHERE lower(email)=lower($1)`, [email]);
    if (existed.rowCount) return res.status(409).json({ ok:false, error:'Email already registered.' });

    const hash = await bcrypt.hash(String(password), 10);
    const r = await q(
      `INSERT INTO public.users (name,email,password_hash)
       VALUES ($1,$2,$3)
       RETURNING id,name,email,level,coins,verified,created_at`,
      [name || email.split('@')[0], email, hash]
    );
    const user = r.rows[0];
    req.session.user = user;
    res.json({ ok:true, redirect:'/' });
  }catch(e){
    console.error('Register error:', e);
    res.status(500).json({ ok:false, error:'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try{
    const { email='', password='' } = req.body || {};
    const r = await q(
      `SELECT id,name,email,password_hash,level,coins,verified FROM public.users WHERE lower(email)=lower($1)`,
      [email]
    );
    if (!r.rowCount) return res.status(401).json({ ok:false, error:'Invalid email or password.' });
    const row = r.rows[0];
    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) return res.status(401).json({ ok:false, error:'Invalid email or password.' });
    const user = { id: row.id, name: row.name, email: row.email, level: row.level, coins: row.coins, verified: row.verified };
    req.session.user = user;
    res.json({ ok:true, redirect:'/' });
  }catch(e){
    console.error('Login error:', e);
    res.status(500).json({ ok:false, error:'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok:true, redirect:'/' }));
});

/* ----------------------- Games ----------------------- */
let games = new Map();

function stableIdFromFolder(folder){
  const s = String(folder);
  let h = 0; for (let i=0;i<s.length;i++) h = ((h<<5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function loadGames(){
  const gdir = path.join(__dirname, 'games');
  const map = new Map();
  if (!fs.existsSync(gdir)) { fs.mkdirSync(gdir, {recursive:true}); games = map; return; }

  const folders = fs.readdirSync(gdir, { withFileTypes:true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a,b)=>a.localeCompare(b));

  folders.forEach(folder=>{
    const dir = path.join(gdir, folder);
    const id = stableIdFromFolder(folder);

    let meta = {};
    const metaFile = path.join(dir, 'game.json');
    if (fs.existsSync(metaFile)) {
      try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
      catch(e){ console.warn('meta parse fail:', folder, e.message); }
    }

    let entryFile = meta.entryFile || null;
    const candidates = ['index.html','game.html','main.html',`${folder}.html`];
    if (!entryFile) {
      const c = candidates.find(f => fs.existsSync(path.join(dir, f)));
      if (c) entryFile = c;
    }
    if (!entryFile) {
      const anyHtml = fs.readdirSync(dir).find(f => /\.html?$/i.test(f)) || null;
      if (anyHtml) entryFile = anyHtml;
    }
    if (!entryFile) { console.warn(`skip ${folder}: no html entry`); return; }

    const displayName = (meta.name && String(meta.name).trim())
      ? String(meta.name).trim()
      : folder.replace(/[-_]/g,' ').replace(/\b\w/g, m=>m.toUpperCase());

    map.set(id, {
      id, folder,
      name: displayName,
      description: meta.description || `A fun game: ${displayName}`,
      icon: meta.icon || '🎮',
      category: meta.category || 'General',
      entryFile
    });
  });

  games = map;
}
loadGames();

app.get('/api/games', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok:false, error:'Unauthorized' });
  loadGames();
  res.json({ ok:true, items: Array.from(games.values()).map(g=>({
    id:g.id, name:g.name, description:g.description, icon:g.icon, category:g.category
  }))});
});

app.get('/play/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  loadGames();
  const gameId = parseInt(req.params.id, 10);
  const game = games.get(gameId);
  if (!game) return res.redirect('/');
  const file = path.join(__dirname, 'games', game.folder, game.entryFile);
  if (fs.existsSync(file)) return res.sendFile(file);
  const dir = path.join(__dirname, 'games', game.folder);
  if (fs.existsSync(dir)) return res.redirect(`/games/${encodeURIComponent(game.folder)}/${encodeURIComponent(game.entryFile)}`);
  return res.status(404).send('Game not found');
});

/* ----------------------- Admin ----------------------- */
app.get('/admin/users.json', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const r = await q(`SELECT id,name,email,level,coins,verified,created_at FROM public.users ORDER BY id DESC`);
  res.json({ ok:true, count:r.rowCount, users:r.rows });
});

app.get('/admin/export-users.csv', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const r = await q(`SELECT name,email,level,coins,verified,created_at FROM public.users ORDER BY created_at DESC`);
  const header = 'name,email,level,coins,verified,created_at';
  const lines = r.rows.map(row => [
    (row.name || '').replace(/"/g,'""'),
    (row.email || '').replace(/"/g,'""'),
    row.level ?? 1,
    row.coins ?? 0,
    row.verified ? 1 : 0,
    (row.created_at?.toISOString?.() || row.created_at || '')
  ].map(x => `"${x}"`).join(','));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="users.csv"');
  res.send([header, ...lines].join('\n'));
});

app.post('/admin/send-email', express.json({limit:'200kb'}), async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!process.env.SENDGRID_API_KEY) return res.status(400).json({ ok:false, error:'SENDGRID_API_KEY not set' });
  ensureSendGrid();
  const { subject='', html='', filter='all' } = req.body || {};
  if (!subject || !html) return res.status(400).json({ ok:false, error:'subject and html are required' });
  let sql = `SELECT email FROM public.users`;
  if (filter === 'verified') sql += ` WHERE verified=true`;
  const r = await q(sql);
  const emails = r.rows.map(x=>x.email).filter(Boolean);
  if (!emails.length) return res.json({ ok:false, sent:0, error:'no recipients' });
  try{
    await sgMail.sendMultiple({ to:emails, from:process.env.MAIL_FROM || 'no-reply@example.com', subject, html });
    res.json({ ok:true, sent:emails.length });
  }catch(e){
    console.error('SendGrid error:', e?.response?.body || e);
    res.status(500).json({ ok:false, error:'send failed' });
  }
});

app.get('/admin/dbcheck', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try{
    const info = await q(`select current_database() db, current_user "user",
                           current_schema schema, inet_server_addr() ip, inet_server_port() port`);
    const cnt = await q(`select count(*)::int n from public.users`);
    res.json({ ok:true, ...info.rows[0], user_count: cnt.rows[0].n });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

/* ----------------------- Start ----------------------- */
app.get('/healthz', (_req, res) => res.json({ ok:true }));

app.listen(PORT, async () => {
  await initDB();
  console.log('[HTTP] listening on :%s', PORT);
});
