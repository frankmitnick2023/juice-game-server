// server.js - 修复版（带日志 + 私有连接 + 建表）
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 使用私有连接（关键！）
const pool = new Pool({
  connectionString: process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true
});

// 连接事件日志
pool.on('connect', () => console.log('DB Connected (Private URL)'));
pool.on('error', (err) => console.error('DB Pool Error:', err.message));

// 强制建表
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
      );
      CREATE TABLE IF NOT EXISTS game_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        game_id TEXT,
        duration INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Tables ensured');
  } catch (e) {
    console.error('Table creation failed:', e.message);
  }
})();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static('public'));
app.use('/games', express.static('games'));

// 注册 - 精确错误
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing email or password' });

  try {
    // 先查邮箱
    const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.json({ ok: false, error: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );
    req.session.user = result.rows[0];
    console.log('Registered:', email);
    res.json({ ok: true });
  } catch (e) {
    console.error('Register failed:', e.code, e.message);
    if (e.code === '23505') {
      res.json({ ok: false, error: 'Email already exists' });
    } else if (e.code === '28P01' || e.code === 'ECONNREFUSED') {
      res.json({ ok: false, error: 'Database connection failed' });
    } else {
      res.json({ ok: false, error: 'Server error' });
    }
  }
});