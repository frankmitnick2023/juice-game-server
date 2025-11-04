// server.js - Juice Game MVP (PostgreSQL + Mediapipe Ready)
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/juice_game',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Init DB
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
    console.log('DB tables ready');
  } catch (e) {
    console.error('DB init failed:', e.message);
  }
})();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-mvp-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', maxAge: 24 * 60 * 60 * 1000 }
}));

// Static
app.use(express.static('public'));
app.use('/games', express.static('games'));

// Game Manifest
let gameManifest = [];
try {
  const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
  if (fs.existsSync(manifestPath)) {
    gameManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
} catch (e) { console.warn('game-manifest.json not found'); }

// API: Register
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Email and password required' });

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.json({ ok: false, error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name, level, coins, total_time',
      [email, hash, name || email.split('@')[0]]
    );
    req.session.user = result.rows[0];
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: 'Server error' });
  }
});

// API: Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.json({ ok: false, error: 'Invalid email or password' });
  }
  req.session.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    level: user.level,
    coins: user.coins,
    total_time: user.total_time
  };
  res.json({ ok: true });
});

// API: Me
app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: req.session.user || null });
});

// API: Games
app.get('/api/games', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, error: 'Login required' });
  const games = gameManifest.length > 0 ? gameManifest : [
    { id: 'demo', name: 'Demo Game', entry: '/games/demo-game.html', platform: 'mobile' },
    { id: 'mobile', name: 'Juice Maker Mobile', entry: '/games/juice-maker-mobile/index.html', platform: 'mobile' },
    { id: 'pc', name: 'Juice Maker PC', entry: '/games/juice-maker-PC/index.html', platform: 'pc' }
  ];
  res.json({ ok: true, games });
});

// API: Start Game Session
app.post('/api/game/start', async (req, res) => {
  if (!req.session.user) return res.json({ ok: false });
  const { game_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO game_sessions (user_id, game_id) VALUES ($1, $2) RETURNING id',
      [req.session.user.id, game_id]
    );
    res.json({ ok: true, session_id: result.rows[0].id });
  } catch (e) {
    res.json({ ok: false, error: 'Failed to start' });
  }
});

// API: End Game Session
app.post('/api/game/end', async (req, res) => {
  if (!req.session.user) return res.json({ ok: false });
  const { session_id, duration, score } = req.body;
  try {
    await pool.query(
      'UPDATE game_sessions SET duration = $1, score = $2 WHERE id = $3 AND user_id = $4',
      [duration, score || 0, session_id, req.session.user.id]
    );
    await pool.query(
      'UPDATE users SET total_time = total_time + $1, coins = coins + $2 WHERE id = $3',
      [duration, Math.floor(duration / 60), req.session.user.id]
    );
    const updated = await pool.query('SELECT coins, total_time FROM users WHERE id = $1', [req.session.user.id]);
    req.session.user.coins = updated.rows[0].coins;
    req.session.user.total_time = updated.rows[0].total_time;
    res.json({ ok: true, coins: updated.rows[0].coins });
  } catch (e) {
    res.json({ ok: false });
  }
});

// Play Page
app.get('/play/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const game = gameManifest.find(g => g.id === req.params.id) || { entry: '/games/demo-game.html' };
  res.sendFile(path.join(__dirname, 'games', game.entry.replace(/^\//, '')));
});

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Juice Game MVP running on :${PORT}`);
});