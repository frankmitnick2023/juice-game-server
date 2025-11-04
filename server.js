const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Pool with timeout
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,  // 5s 连接超时
  query_timeout: 10000,          // 10s 查询超时
  keepAlive: true
});

pool.on('connect', () => console.log('DB Connected'));
pool.on('error', (err) => console.error('DB Error:', err.message));

// 建表
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        total_time INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        coins INTEGER DEFAULT 100,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('Users table ready');
  } catch (e) {
    console.error('Table error:', e.message);
  }
})();

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static('public'));
app.use('/games', express.static('games'));

// 健康检查（Railway 推荐）
app.get('/healthz', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// 注册 API（加超时 + 日志）
app.post('/api/register', async (req, res) => {
  console.log('Register attempt:', req.body.email);
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.json({ ok: false, error: 'Missing email or password' });
  }

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.json({ ok: false, error: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email',
      [email, hash, name || null]
    );
    req.session.user = result.rows[0];
    console.log('Registered:', email);
    res.json({ ok: true });
  } catch (e) {
    console.error('Register error:', e.code, e.message);
    res.json({ ok: false, error: 'Server error' });
  }
});

// 登录 API（类似修复）
app.post('/api/login', async (req, res) => {
  console.log('Login attempt:', req.body.email);
  const { email, password } = req.body;
  const timeout = setTimeout(() => res.status(408).json({ ok: false, error: 'Timeout' }), 10000);

  try {
    clearTimeout(timeout);
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      console.log('Login fail: invalid credentials');
      return res.json({ ok: false, error: 'Invalid credentials' });
    }
    req.session.user = { id: user.id, email: user.email };
    console.log('Login success:', email);
    res.json({ ok: true });
  } catch (e) {
    clearTimeout(timeout);
    console.error('Login error:', e.message);
    res.json({ ok: false, error: 'Server error' });
  }
});

// Me API
app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: req.session.user || null });
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {  // 绑定 0.0.0.0（Railway 要求）
  console.log(`Server running on :${PORT}`);
});