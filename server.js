// server.js - 修复无限刷新问题
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
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static('public'));
app.use('/games', express.static('games'));

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Register
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing fields' });

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.json({ ok: false, error: 'Email exists' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email',
      [email, hash, name || null]
    );
    req.session.user = result.rows[0];
    res.json({ ok: true });
  } catch (e) {
    console.error('Register error:', e);
    res.json({ ok: false, error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing fields' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.json({ ok: false, error: 'Invalid credentials' });
    }
    req.session.user = { id: user.id, email: user.email };
    res.json({ ok: true });
  } catch (e) {
    console.error('Login error:', e);
    res.json({ ok: false, error: 'Server error' });
  }
});

// Me - 防止无限重定向
app.get('/api/me', (req, res) => {
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

    // 添加 demo-game.html
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

  res.json({ ok: true, games });
});

// 播放页面
app.get('/play/:id', (req, res) => {
  const { id } = req.params;
  const user = req.session.user;
  if (!user) return res.redirect('/');

  let gameUrl = '';
  let gameTitle = 'Unknown';

  if (id === 'demo') {
    gameUrl = '/games/demo-game.html';
    gameTitle = 'Demo Game';
  } else {
    const gameJsonPath = path.join(__dirname, 'games', id, 'game.json');
    const indexPath = path.join(__dirname, 'games', id, 'index.html');
    if (fs.existsSync(gameJsonPath) && fs.existsSync(indexPath)) {
      try {
        const game = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
        gameTitle = game.title || id;
        gameUrl = `/games/${id}/index.html`;
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

// Fallback - 防止无限刷新
app.get('*', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on :${PORT}`);
});