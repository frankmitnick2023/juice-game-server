// server.js - 终极修复：登录失败 + 详细日志 + Session 持久化
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  queryTimeout: 15000,
  keepAlive: true
});

pool.on('connect', () => console.log('DB Connected'));
pool.on('error', (err) => console.error('DB Pool Error:', err.message));

// 建表
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('DB Connection OK');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        level INTEGER DEFAULT 1,
        coins INTEGER DEFAULT 100,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('Users table ensured');
  } catch (e) {
    console.error('DB Setup Failed:', e.message);
  }
})();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session - 关键修复：使用内存存储 + 持久化
const MemoryStore = require('memorystore')(session);
const sessionStore = new MemoryStore({
  checkPeriod: 86400000 // 每天清理过期
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-2025-secure',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

app.use(express.static('public', { 
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
app.use('/games', express.static('games', { maxAge: '1d' }));

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Register
app.post('/api/register', async (req, res) => {
  console.log('REGISTER REQUEST:', req.body);
  const { email, password, name } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing email or password' });

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (exists.rows.length > 0) {
      console.log('Register failed: email exists');
      return res.json({ ok: false, error: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email',
      [email.trim().toLowerCase(), hash, name?.trim() || null]
    );

    const user = result.rows[0];
    req.session.user = { id: user.id, email: user.email };
    req.session.save(err => {
      if (err) console.error('Session save error:', err);
      console.log('REGISTER SUCCESS:', user.email, 'Session ID:', req.session.id);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('Register DB error:', e);
    res.json({ ok: false, error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  console.log('LOGIN REQUEST:', req.body);
  const { email, password } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing email or password' });

  try {
    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    console.log('DB lookup:', result.rows.length > 0 ? 'User found' : 'No user');

    if (result.rows.length === 0) {
      return res.json({ ok: false, error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    console.log('Password match:', match);

    if (!match) {
      return res.json({ ok: false, error: 'Invalid email or password' });
    }

    req.session.user = { id: user.id, email: user.email };
    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.json({ ok: false, error: 'Session error' });
      }
      console.log('LOGIN SUCCESS:', user.email, 'Session ID:', req.session.id);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('Login DB error:', e);
    res.json({ ok: false, error: 'Server error' });
  }
});

// Me - 添加详细日志
app.get('/api/me', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  console.log('ME CHECK:', req.session.user ? `Logged in as ${req.session.user.email}` : 'Not logged in');
  res.json({ ok: true, user: req.session.user || null });
});

// 游戏列表 API
app.get('/api/games', (req, res) => {
  const gamesDir = path.join(__dirname, 'games');
  const games = [];

  try {
    if (!fs.existsSync(gamesDir)) {
      return res.json({ ok: true, games: [] });
    }

    const items = fs.readdirSync(gamesDir);
    console.log('Scanning games directory:', items);

    items.forEach(item => {
      try {
        const itemPath = path.join(gamesDir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          const gameJsonPath = path.join(itemPath, 'game.json');
          const indexPath = path.join(itemPath, 'index.html');

          if (fs.existsSync(gameJsonPath) && fs.existsSync(indexPath)) {
            const raw = fs.readFileSync(gameJsonPath, 'utf8');
            const game = JSON.parse(raw);
            game.id = item;
            game.url = `/games/${item}/index.html`;
            games.push(game);
            console.log(`Loaded game: ${item}`);
          }
        }
      } catch (e) {
        console.error(`Error loading game ${item}:`, e.message);
      }
    });

    const demoPath = path.join(gamesDir, 'demo-game.html');
    if (fs.existsSync(demoPath)) {
      games.unshift({
        id: 'demo',
        title: 'Demo Game',
        description: '基于摄像头动作捕捉的演示游戏',
        platform: 'any',
        url: '/games/demo-game.html'
      });
      console.log('Loaded demo game');
    }

  } catch (e) {
    console.error('Fatal error in /api/games:', e);
    return res.status(500).json({ ok: false, error: 'Failed to scan games' });
  }

  res.setHeader('Cache-Control', 'no-cache');
  res.json({ ok: true, games });
});

// 播放页面
app.get('/play/:id', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/?redirect=/play/' + req.params.id);
  }

  let gameUrl = '';
  let gameTitle = 'Unknown';

  if (req.params.id === 'demo') {
    gameUrl = '/games/demo-game.html';
    gameTitle = 'Demo Game';
  } else {
    const gameJsonPath = path.join(__dirname, 'games', req.params.id, 'game.json');
    const indexPath = path.join(__dirname, 'games', req.params.id, 'index.html');
    if (fs.existsSync(gameJsonPath) && fs.existsSync(indexPath)) {
      try {
        const game = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
        gameTitle = game.title || req.params.id;
        gameUrl = `/games/${req.params.id}/index.html`;
      } catch (e) {
        return res.status(500).send('Game config error');
      }
    } else {
      return res.status(404).send('Game not found');
    }
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${gameTitle} - Juice Game</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body, html { margin:0; padding:0; height:100%; background:#000; }
    iframe { width:100%; height:100%; border:none; }
    .back { position:absolute; top:15px; left:15px; z-index:100; background:rgba(0,0,0,0.6); color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-family:sans-serif; font-size:14px; }
    .back:hover { background:rgba(0,0,0,0.8); }
  </style>
</head>
<body>
  <a href="/games.html" class="back">Back to Games</a>
  <iframe src="${gameUrl}" allowfullscreen></iframe>
</body>
</html>
  `;
  res.send(html);
});

// 游戏列表页
app.get('/games.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'games.html'));
});

// Fallback
app.get('*', (req, res, next) => {
  const filePath = path.join(__dirname, 'public', req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  if (req.path === '/' || req.path === '/index.html') {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on :${PORT}`);
  console.log(`Session store initialized: ${sessionStore.size()} sessions`);
});