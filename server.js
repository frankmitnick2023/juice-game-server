// server.js
const express = require('express');
const session = require('express-session');
let pgSession;
try {
  pgSession = require('connect-pg-simple')(session);
} catch (e) {
  console.warn('connect-pg-simple not available, using memory store');
}
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const sessionStore = pgSession ? new pgSession({ pool, tableName: 'session' }) : new session.MemoryStore();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000 }
}));

app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games'));

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
    if (pgSession) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS session (
          sid VARCHAR NOT NULL COLLATE "default",
          sess JSON NOT NULL,
          expire TIMESTAMP(6) NOT NULL
        ) WITH (OIDS=FALSE);
        CREATE INDEX IF NOT EXISTS session_expire_idx ON session(expire);
      `);
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.error('DB init failed:', err.message);
  }
})();

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
  res.json(req.session.user || { error: 'Not logged in' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

function scanGames() {
  const games = {};
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
    games.demo = { id: 'demo', title: 'Demo Game', description: 'Simple demo', thumbnail: '', platform: 'both', entry: '/games/demo-game.html' };
  }
  ['juice-maker-mobile', 'juice-maker-PC'].forEach(dir => {
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
function getGames() {
  if (!gameCache) gameCache = scanGames();
  return gameCache;
}

app.get('/api/games', (req, res) => res.json(getGames()));

app.get('/play/:id', async (req, res) => {
  const gameId = req.params.id;
  const game = getGames().find(g => g.id === gameId);
  if (!game) return res.status(404).send('Game not found');
  if (!req.session.user) return res.redirect(`/?redirect=${encodeURIComponent('/play/' + gameId)}`);
  let scores = [];
  try {
    const r = await pool.query(
      'SELECT score, created_at FROM scores WHERE user_id = $1 AND game_id = $2 ORDER BY score DESC LIMIT 5',
      [req.session.user.id, gameId]
    );
    scores = r.rows;
  } catch (e) { console.error(e); }
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${game.title}</title>
<style>
  body{font-family:Arial;margin:0;background:#f4f4f4}
  .header{background:#ff6b35;color:#fff;padding:1rem;text-align:center;position:relative}
  .back{position:absolute;left:1rem;top:1rem;color:#fff;text-decoration:none}
  .container{max-width:1200px;margin:auto;padding:1rem}
  iframe{width:100%;height:70vh;border:none;border-radius:8px}
  .scores{background:#fff;padding:1rem;margin-top:1rem;border-radius:8px}
  .score-item{display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid #eee}
</style>
</head><body>
<div class="header"><a href="/games.html" class="back">Back</a><h1>${game.title}</h1></div>
<div class="container">
  <iframe src="${game.entry}"></iframe>
  <div class="scores"><h3>Top Scores</h3>
    ${scores.length ? scores.map(s=>`<div class="score-item"><span>${s.score}</span><span>${new Date(s.created_at).toLocaleString()}</span></div>`).join('') : '<p>No scores yet</p>'}
  </div>
</div>
<script>
  window.addEventListener('message', async e => {
    if (e.data?.type === 'JUICE_GAME_SCORE') {
      await fetch('/api/score', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:'${gameId}',score:e.data.score})});
      location.reload();
    }
  });
</script>
</body></html>`);
});

app.post('/api/score', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Login required' });
  const { gameId, score } = req.body;
  if (!gameId || typeof score !== 'number') return res.status(400).json({ error: 'Invalid' });
  try {
    await pool.query('INSERT INTO scores (user_id, game_id, score) VALUES ($1,$2,$3)', [req.session.user.id, gameId, score]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Save failed' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));