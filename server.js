require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games'));

const normalizeEmail = (email) => email?.toLowerCase().trim();

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 chars' });

  const emailNorm = normalizeEmail(email);
  
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, level, coins)
       VALUES ($1, $2, 1, 100)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id, email, level, coins`,
      [emailNorm, hash]
    );

    if (result.rowCount > 0) {
      return res.status(201).json({ message: 'Success', user: result.rows[0] });
    }

    const existing = await pool.query(
      `SELECT id, email, level, coins FROM users WHERE lower(email) = $1`,
      [emailNorm]
    );
    return res.status(200).json({ message: 'User exists', user: existing.rows[0] });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Database error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const emailNorm = normalizeEmail(email);

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, level, coins FROM users WHERE lower(email) = $1`,
      [emailNorm]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    delete user.password_hash;
    return res.json({ message: 'Login success', user });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Database error during login' });
  }
});

app.get('/api/games', async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
    const data = await fs.promises.readFile(manifestPath, 'utf-8');
    const games = JSON.parse(data);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const enriched = games.map(game => ({
      ...game,
      url: game.type === 'single'
        ? `${baseUrl}/games/${game.id}.html`
        : `${baseUrl}/games/${game.id}/index.html`
    }));

    res.json(enriched);
  } catch (err) {
    console.error('Manifest error:', err);
    res.status(500).json({ error: 'Failed to load game list' });
  }
});

app.get('/play/:id', (req, res) => {
  const { id } = req.params;
  const filePath = path.join(__dirname, 'games', id, 'index.html');
  const singlePath = path.join(__dirname, 'games', `${id}.html`);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  if (fs.existsSync(singlePath)) {
    return res.sendFile(singlePath);
  }
  res.status(404).send('Game not found');
});

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.send('Juice Game Server is Running!');
});

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

pool.connect()
  .then(client => {
    console.log('DB Connected');
    client.release();
    startServer();
  })
  .catch(err => {
    console.error('DB Failed:', err.message);
    console.log('Starting in NO-DB mode...');
    startServer();
  });