// server.js
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const app = express();

// PostgreSQL 连接池
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Session 配置
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'juice-game-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games'));

// 创建必要表
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    coins INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL COLLATE "default",
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
  ) WITH (OIDS=FALSE);
  CREATE INDEX IF NOT EXISTS session_expire_idx ON session(expire);
  CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    game_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(() => {});

// 注册
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

// 登录
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

// 获取当前用户
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

// 登出
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// 扫描游戏清单
function scanGames() {
  const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
  let manifest = [];

  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {}
  }

  const games = {};
  manifest.forEach(g => games[g.id] = g);

  const dirs = ['juice-maker-mobile', 'juice-maker-PC'];
  dirs.forEach(dir => {
    const dirPath = path.join(__dirname, 'games', dir);
    if (!fs.existsSync(dirPath)) return;
    const jsonPath = path.join(dirPath, 'game.json');
    if (!fs.existsSync(jsonPath)) return;

    const gameData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const id = dir;
    games[id] = {
      id,
      title: gameData.title || dir,
      description: gameData.description || '',
      thumbnail: gameData.thumbnail || '',
      platform: dir.includes('mobile') ? 'mobile' : 'pc',
      entry: `/games/${dir}/index.html`
    };
  });

  // demo-game
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
    games['demo'] = {
      id: 'demo',
      title: 'Demo Game',
      description: 'Simple demo game',
      thumbnail: '',
      platform: 'both',
      entry: '/games/demo-game.html'
    };
  }

  return Object.values(games);
}

let gameListCache = null;
function getGameList() {
  if (!gameListCache) gameListCache = scanGames();
  return gameListCache;
}

// 游戏列表 API
app.get('/api/games', (req, res) => {
  res.json(getGameList());
});

// 播放页面
app.get('/play/:id', async (req, res) => {
  const gameId = req.params.id;
  const games = getGameList();
  const game = games.find(g => g.id === gameId);
  if (!game) return res.status(404).send('Game not found');

  if (!req.session.user) {
    return res.redirect('/?redirect=/play/' + gameId);
  }

  let scores = [];
  try {
    const result = await pool.query(
      'SELECT score, created_at FROM scores WHERE user_id = $1 AND game_id = $2 ORDER BY score DESC LIMIT 5',
      [req.session.user.id, gameId]
    );
    scores = result.rows;
  } catch (e) {}

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${game.title} - Juice Game</title>
  <style>
    body{font-family:Arial;margin:0;background:#f4f4f4}
    .header{background:#ff6b35;color:white;padding:1rem;text-align:center;position:relative}
    .back{position:absolute;left:1rem;top:1rem;color:white;text-decoration:none}
    .container{max-width:1200px;margin:auto;padding:1rem}
    .game-frame{width:100%;height:70vh;border:none;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
    .scores{margin-top:1rem;background:white;padding:1rem;border-radius:8px}
    .score-item{display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid #eee}
    .no-scores{color:#666;text-align:center;padding:1rem}
    iframe{width:100%;height:100%;border:none}
  </style>
</head>
<body>
  <div class="header">
    <a href="/games.html" class="back">← Back</a>
    <h1>${game.title}</h1>
  </div>
  <div class="container">
    <iframe src="${game.entry}" class="game-frame"></iframe>
    <div class="scores">
      <h3>Your Top Scores</h3>
      ${scores.length ? scores.map(s => `
        <div class="score-item">
          <span>${s.score} points</span>
          <span>${new Date(s.created_at).toLocaleString()}</span>
        </div>
      `).join('') : '<p class="no-scores">No scores yet. Play to record!</p>'}
    </div>
  </div>
  <script>
    window.addEventListener('message', async e => {
      if (e.data && e.data.type === 'JUICE_GAME_SCORE') {
        const score = e.data.score;
        await fetch('/api/score', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({gameId: '${gameId}', score})
        });
        location.reload();
      }
    });
  </script>
</body>
</html>
  `;
  res.send(html);
});

// 提交分数
app.post('/api/score', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { gameId, score } = req.body;
  if (!gameId || typeof score !== 'number') return res.status(400).json({ error: 'Invalid data' });

  try {
    await pool.query(
      'INSERT INTO scores (user_id, game_id, score) VALUES ($1, $2, $3)',
      [req.session.user.id, gameId, score]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Save failed' });
  }
});

// 重定向根路径到登录页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 游戏大厅页
app.get('/games.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'games.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});