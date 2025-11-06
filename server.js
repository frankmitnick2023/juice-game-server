// server.js
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const MemoryStore = session.MemoryStore;
const sessionStore = new MemoryStore();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games'));

// === 捕获 aborted 请求 ===
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed' || error.code === 'ECONNABORTED') {
    console.warn('Request aborted:', req.path);
    if (!res.headersSent) res.status(400).end();
    return;
  }
  console.error('Unhandled error:', error);
  if (!res.headersSent) res.status(500).json({ error: 'Server error' });
});

// === 初始化数据库 ===
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        coins INTEGER DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Database initialized');
  } catch (err) {
    console.error('DB init error:', err.message);
  }
})();

// === API 端点（保持不变）===
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, level, coins',
      [email, hash]
    );
    req.session.user = result.rows[0];
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    delete user.password_hash;
    req.session.user = user;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', (req, res) => {
  res.json(req.session.user || null);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

function scanGames() {
  const games = {};
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
    games['demo'] = {
      id: 'demo',
      title: 'Demo Game',
      description: 'Demo',
      thumbnail: '',
      platform: 'both',
      entry: '/games/demo-game.html'
    };
  }
  ['juice-maker-mobile','demo-game','rhythm-challenger','rhythm-challenger-trainning','Ready!!Action!!','juice-maker-PC'].forEach(dir => {
    const jsonPath = path.join(__dirname, 'games', dir, 'game.json');
    if (!fs.existsSync(jsonPath)) return;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return; }
    games[dir] = {
      id: dir,
      title: meta.title || dir,
      description: meta.description || '',
      thumbnail: meta.thumbnail || '',
      platform: dir.includes('mobile') ? 'mobile' : 'pc',
      entry: `/games/${dir}/index.html`
    };
  });
  return Object.values(games);
}

let gameCache = null;
app.get('/api/games', (req, res) => {
  if (!gameCache) gameCache = scanGames();
  res.json(gameCache);
});

app.get('/play/:id', async (req, res) => {
  const gameId = req.params.id;
  const games = gameCache || scanGames();
  const game = games.find(g => g.id === gameId);
  if (!game) return res.status(404).send('Game not found');

  if (!req.session.user) {
    return res.redirect(`/?redirect=${encodeURIComponent('/play/' + gameId)}`);
  }

  // 所有游戏都走 wrapper
  const wrapperUrl = `/wrapper.html?src=${encodeURIComponent(game.entry)}`;

  let scores = [];
  try {
    const r = await pool.query(
      'SELECT score, created_at FROM scores WHERE user_id = $1 AND game_id = $2 ORDER BY score DESC LIMIT 10',
      [req.session.user.id, gameId]
    );
    scores = r.rows;
  } catch (e) {}

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${game.title}</title>
  <style>
    body{font-family:Arial;margin:0;background:#f4f4f4}
    .header{background:#ff6b35;color:#fff;padding:1rem;text-align:center;position:relative}
    .back{position:absolute;left:1rem;top:1rem;color:#fff;text-decoration:none}
    .container{max-width:1200px;margin:auto;padding:1rem}
    iframe{width:100%;height:75vh;border:none;border-radius:8px}
    .scores{background:#fff;padding:1.5rem;margin-top:1rem;border-radius:8px}
  </style>
</head>
<body>
  <div class="header">
    <a href="/games.html" class="back">返回</a>
    <h1>${game.title}</h1>
  </div>
  <div class="container">
    <iframe src="${wrapperUrl}" allowfullscreen></iframe>
    <div class="scores">
      <h3>你的历史分数</h3>
      ${scores.length ? scores.map(s => `<div><strong>${s.score}</strong> - ${new Date(s.created_at).toLocaleString()}</div>`).join('') : '<p>暂无记录</p>'}
    </div>
  </div>
</body>
</html>`);
});

app.post('/api/score', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { gameId, score } = req.body;
  if (!gameId || typeof score !== 'number') return res.status(400).json({ error: 'Invalid' });
  try {
    await pool.query('INSERT INTO scores (user_id, game_id, score) VALUES ($1,$2,$3)', [req.session.user.id, gameId, score]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Save failed' });
  }
});

// === 健康检查端点（Railway 必需）===
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));