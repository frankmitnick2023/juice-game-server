// server.js
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 30000,      // 30s idle 超时
  connectionTimeoutMillis: 10000, // 10s 连接超时
  max: 20,                       // 最大连接
  keepAlive: true,               // 保持连接
  keepAliveInitialDelayMillis: 10000  // 10s 后开始 keepalive
});

// 连接事件监听（日志化）
pool.on('connect', () => console.log('✅ DB Connected'));
pool.on('error', (err) => {
  console.error('❌ DB Error:', err.code, err.message);
  // 可选：重启 pool
  pool.end().then(() => {
    // 重新初始化 pool
  });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto' }
}));

app.use(express.static('public'));
app.use('/games', express.static('games'));

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing fields' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );
    req.session.user = result.rows[0];
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: 'Email exists or DB error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.json({ ok: false, error: 'Invalid credentials' });
  }
  req.session.user = { id: user.id, email: user.email };
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: req.session.user || null });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
});