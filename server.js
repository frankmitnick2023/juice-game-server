// server.js
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
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  queryTimeout: 15000,
  keepAlive: true
});

pool.on('connect', () => console.log('DB Connected (Public URL)'));
pool.on('error', (err) => console.error('DB Pool Error:', err.message));

// Ensure users table
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('DB Connection Test OK');
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
    console.log('Users table ensured');
  } catch (e) {
    console.error('DB Setup Failed:', e.message);
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

// Health check
app.get('/healthz', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Register
app.post('/api/register', async (req, res) => {
  console.log('Register attempt:', req.body.email);
  const { email, password, name } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing email or password' });

  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.json({ ok: false, error: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hash, name || null]
    );
    req.session.user = result.rows[0];
    console.log('Registered:', email);
    res.json({ ok: true });
  } catch (e) {
    console.error('Register error:', e.code, e.message);
    res.json({ ok: false, error: e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  console.log('Login attempt:', req.body.email);
  const { email, password } = req.body;
  if (!email || !password) return res.json({ ok: false, error: 'Missing fields' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !await bcrypt.compare(password, user.password_hash)) {
      return res.json({ ok: false, error: 'Invalid credentials' });
    }
    req.session.user = { id: user.id, email: user.email };
    console.log('Login success:', email);
    res.json({ ok: true });
  } catch (e) {
    console.error('Login error:', e.message);
    res.json({ ok: false, error: 'Server error' });
  }
});

// Me
app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: req.session.user || null });
});

// Game List API
app.get('/api/games', async (req, res) => {
  const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json({ ok: true, games: manifest });
  } else {
    const games = [];
    const dirs = ['juice-maker-mobile', 'juice-maker-PC'];
    for (const dir of dirs) {
      const gameJsonPath = path.join(__dirname, 'games', dir, 'game.json');
      if (fs.existsSync(gameJsonPath)) {
        const game = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
        game.id = dir;
        game.url = `/games/${dir}/index.html`;
        games.push(game);
      }
    }
    if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
      games.push({
        id: 'demo',
        title: 'Demo Game',
        description: 'Simple demo game',
        url: '/games/demo-game.html',
        platform: 'any'
      });
    }
    res.json({ ok: true, games });
  }
});

// Play game page
app.get('/play/:id', (req, res) => {
  const { id } = req.params;
  const user = req.session.user;
  if (!user) return res.redirect('/');

  let gameUrl = '';
  if (id === 'demo') {
    gameUrl = '/games/demo-game.html';
  } else if (id === 'juice-maker-mobile' || id === 'juice-maker-PC') {
    gameUrl = `/games/${id}/index.html`;
  } else {
    return res.status(404).send('Game not found');
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${id} - Juice Game</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body, html { margin:0; padding:0; height:100%; overflow:hidden; background:#000; }
    iframe { width:100%; height:100%; border:none; }
    .back { position:absolute; top:10px; left:10px; color:#fff; text-decoration:none; background:rgba(0,0,0,0.5); padding:8px 12px; border-radius:4px; }
  </style>
</head>
<body>
  <a href="/games.html" class="back">Back to Games</a>
  <iframe src="${gameUrl}" allowfullscreen></iframe>
  <script>
    // Record game end
    let startTime = Date.now();
    window.addEventListener('beforeunload', () => {
      const duration = Math.floor((Date.now() - startTime) / 1000);
      fetch('/api/game/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration })
      });
    });
  </script>
</body>
</html>
  `;
  res.send(html);
});

// Game end - award coins
app.post('/api/game/end', async (req, res) => {
  const { duration } = req.body;
  const userId = req.session.user?.id;
  if (!userId || !duration) return res.json({ ok: false });

  try {
    const coinsEarned = Math.floor(duration / 30) * 10;
    await pool.query(
      'UPDATE users SET total_time = total_time + $1, coins = coins + $2 WHERE id = $3',
      [duration, coinsEarned, userId]
    );
    res.json({ ok: true, coinsEarned });
  } catch (e) {
    res.json({ ok: false });
  }
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT email, coins, total_time FROM users ORDER BY coins DESC LIMIT 10'
    );
    res.json({ ok: true, leaderboard: result.rows });
  } catch (e) {
    res.json({ ok: false });
  }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on :${PORT}`);
});