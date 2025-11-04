// server.js — single Pool, robust for Railway

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// ---------- PG connection (auto SSL / internal host aware) ----------
const connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error('[FATAL] Missing env: DATABASE_URL');
  process.exit(1);
}

let ssl = false;
try {
  const u = new URL(connStr);
  const isInternal = /\.railway\.internal$/i.test(u.hostname);
  const wantsSSL  = /sslmode=require/i.test(connStr);
  ssl = wantsSSL ? { rejectUnauthorized: false } : (isInternal ? false : { rejectUnauthorized: false });
} catch {
  ssl = /sslmode=require/i.test(connStr) ? { rejectUnauthorized: false } : false;
}

const pool = new Pool({
  connectionString: connStr,
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
pool.on('connect', (client) => {
  const p = client.connectionParameters || {};
  console.log('[DB] connected host=%s port=%s db=%s user=%s', p.host, p.port, p.database, p.user);
});
pool.on('error', (err) => console.error('[DB] pool error', err));

// ---------- Express ----------
const app = express();
app.use(bodyParser.json());

// ---------- Sessions (PG if available, else Memory in dev) ----------
let pgSession;
try {
  pgSession = require('connect-pg-simple')(session);
  console.log('[SESSION] using connect-pg-simple (Postgres)');
} catch {
  console.warn('[SESSION] connect-pg-simple not installed, using MemoryStore (NOT for production)');
}
const sessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: 'lax',
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
};
if (pgSession) {
  sessionOptions.store = new pgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  });
}
app.use(session(sessionOptions));

// ---------- DB schema (single init) ----------
async function initDB(retry = 0) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log('[DB] schema ensured');
  } catch (e) {
    console.error('[DB] init error:', e.code || e.message);
    if (retry < 5) {
      const delay = 1000 * (retry + 1);
      console.log('[DB] retry in', delay, 'ms');
      await new Promise(r => setTimeout(r, delay));
      return initDB(retry + 1);
    }
    throw e;
  }
}
initDB().catch(err => { console.error('[FATAL] DB init failed', err); process.exit(1); });

// ---------- Password helpers ----------
let bcrypt;
try { bcrypt = require('bcryptjs'); } catch {}
async function hashPwd(p) { return bcrypt ? bcrypt.hash(p, 10) : 'plain:' + p; }
async function checkPwd(p, h) { return bcrypt ? bcrypt.compare(p, h) : (h === 'plain:' + p); }

// ---------- Routes ----------
app.get('/health', async (req, res) => {
  try { const r = await pool.query('select now() as now'); res.json({ ok:true, now: r.rows[0].now }); }
  catch(e){ res.status(500).json({ ok:false, error: e.message }); }
});

app.get('/admin/dbcheck', async (req, res) => {
  try { const r = await pool.query('select count(*)::int as c from users'); res.json({ database:'connected', userCount:r.rows[0].c }); }
  catch(e){ res.status(500).json({ database:'error', error:e.message }); }
});

app.post('/api/register', async (req, res) => {
  try{
    const { name, email, password } = req.body || {};
    if (!email || !password) return res.json({ ok:false, error:'Missing email or password' });
    const pwdHash = await hashPwd(password);
    const q = `insert into users(name,email,password_hash) values($1,$2,$3)
               on conflict(email) do nothing
               returning id,name,email,created_at`;
    const r = await pool.query(q, [name || null, email.toLowerCase(), pwdHash]);
    if (r.rowCount === 0) return res.json({ ok:false, error:'Email already exists' });
    req.session.user = { id:r.rows[0].id, email:r.rows[0].email, name:r.rows[0].name };
    res.json({ ok:true, user:req.session.user });
  }catch(e){
    console.error('/api/register error', e);
    res.status(500).json({ ok:false, error:'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try{
    const { email, password } = req.body || {};
    if (!email || !password) return res.json({ ok:false, error:'Missing email or password' });
    const r = await pool.query('select id,name,email,password_hash from users where email=$1', [email.toLowerCase()]);
    if (r.rowCount === 0) return res.json({ ok:false, error:'Invalid credentials' });
    const ok = await checkPwd(password, r.rows[0].password_hash);
    if (!ok) return res.json({ ok:false, error:'Invalid credentials' });
    req.session.user = { id:r.rows[0].id, email:r.rows[0].email, name:r.rows[0].name };
    res.json({ ok:true, user:req.session.user });
  }catch(e){
    console.error('/api/login error', e);
    res.status(500).json({ ok:false, error:'Server error' });
  }
});

app.get('/api/me', (req, res) => res.json(req.session.user || null));

// Serve the SPA entry
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- static (serve index.html) ----------
const path = require('path');
app.use(express.static(path.join(__dirname)));

// ---------- start ----------
app.listen(PORT, () => console.log('[HTTP] listening on :' + PORT));
process.on('unhandledRejection', e => console.error('[UNHANDLED REJECTION]', e));
process.on('uncaughtException', e => { console.error('[UNCAUGHT EXCEPTION]', e); process.exit(1); });