// server.js - production ready minimal backend

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');

// Trust Railway proxy
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ====== DB CONNECTION ======
let connStr = process.env.DATABASE_URL;
if (!connStr) {
  console.error('[FATAL] Missing DATABASE_URL');
  process.exit(1);
}

// Support Railway internal + external DB SSL auto mode
let ssl = false;
try {
  const u = new URL(connStr);
  const isInternal = /\.railway\.internal$/i.test(u.hostname);
  const wantsSSL = /sslmode=require/i.test(connStr);
  ssl = wantsSSL ? { rejectUnauthorized: false } : (isInternal ? false : { rejectUnauthorized: false });
} catch {
  ssl = /sslmode=require/i.test(connStr) ? { rejectUnauthorized: false } : false;
}

const pool = new Pool({
  connectionString: connStr,
  ssl,
});

// ====== DB SCHEMA ======
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  console.log('[DB] Ready');
}
initDB().catch(e => {
  console.log(e);
  process.exit(1);
});

// ====== BASIC PASSWORD (plaintext DEV ONLY) ======
// ⚠️ IMPORTANT: later we replace with bcrypt
function hash(pw) { return "plain:" + pw; }
function check(pw, stored) { return stored === "plain:" + pw; }

// ====== MIDDLEWARE ======
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, // running behind https on Railway
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// ====== API ======

// Register
app.post('/api/register', async (req, res) => {
  const {email, password, name=""} = req.body || {};
  if (!email || !password) return res.json({ok:false, error:"Missing email/password"});

  try {
    const r = await pool.query(
      `INSERT INTO users(name,email,password_hash)
       VALUES($1,$2,$3)
       ON CONFLICT(email) DO NOTHING
       RETURNING id, name, email`,
      [name, email.toLowerCase(), hash(password)]
    );

    if (r.rowCount === 0) return res.json({ok:false, error:"Email exists"});

    req.session.user = r.rows[0];
    return res.json({ok:true, user:req.session.user});
  } catch(e) {
    console.log(e);
    return res.json({ok:false, error:"Server error"});
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const {email, password} = req.body || {};
  if (!email || !password) return res.json({ok:false});

  const r = await pool.query(
    `SELECT id, name, email, password_hash FROM users WHERE email=$1`,
    [email.toLowerCase()]
  );
  if (r.rowCount === 0) return res.json({ok:false, error:"Invalid credentials"});

  if (!check(password, r.rows[0].password_hash))
    return res.json({ok:false, error:"Invalid credentials"});

  req.session.user = {
    id:r.rows[0].id,
    email:r.rows[0].email,
    name:r.rows[0].name
  };

  return res.json({ok:true, user:req.session.user});
});

// Me
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ok:false});
  return res.json({ok:true, user:req.session.user});
});

// Lobby games placeholder
app.get('/api/games', (req,res)=>{
  return res.json({ok:true, items:[]});
});

// ====== STATIC FRONTEND ======
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname, 'public','index.html'));
});

// ====== START ======
app.listen(PORT, ()=> console.log(`✅ Server running on ${PORT}`));