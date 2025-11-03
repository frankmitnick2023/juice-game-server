/**
 * FunX / Juice Game Server — sql.js (WASM) edition
 * - 无原生模块，避免 ELF 报错；Railway/Hobby 完全兼容
 * - 数据库存储为二进制文件：/app/data/users.sqlite（回退到 ./data/users.sqlite）
 * - API 与之前保持一致：
 *   /api/register, /api/login, /api/me, /api/games, /api/logout, /play/:id
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 8080;

/* ------------------------ Data dir & DB file ------------------------ */
function detectDataDir() {
  const preferred = '/app/data';
  try { if (fs.existsSync(preferred)) return preferred; } catch {}
  return path.join(__dirname, 'data');
}
const DATA_DIR = process.env.DATA_DIR || detectDataDir();
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'users.sqlite');

// sql.js 相关（懒加载）
let SQL = null;     // sql.js 模块
let db = null;      // 数据库实例

async function getDB() {
  if (!SQL) {
    SQL = await initSqlJs({
      // 可选：自定义 wasm 路径；若不设置，sql.js 会用包内置路径
      // locateFile: (file) => `/${file}`
    });
  }
  if (!db) {
    if (fs.existsSync(DB_FILE)) {
      const filebuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(filebuffer);
    } else {
      db = new SQL.Database();
      // 初始化表结构
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT NOT NULL,
          email         TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          level         INTEGER NOT NULL DEFAULT 1,
          coins         INTEGER NOT NULL DEFAULT 0,
          verified      INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      await saveDB();
    }
  }
  return db;
}

async function saveDB() {
  if (!db) return;
  const data = db.export();             // Uint8Array
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

/* ------------------------ Express setup ------------------------ */
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/games', express.static(path.join(__dirname, 'games')));
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: 'auto',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

/* ------------------------ SPA entry ------------------------ */
function sendIndex(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
}
app.get('/', sendIndex);
app.get('/login', sendIndex);
app.get('/register', sendIndex);

/* ------------------------ Helpers (sql.js) ------------------------ */
function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}
function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

/* ------------------------ Users API ------------------------ */
app.get('/api/me', async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, user: null });
  res.json({ ok: true, user: u });
});

app.post('/api/register', async (req, res) => {
  try {
    const { name = '', email = '', password = '' } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password are required.' });
    }
    await getDB();
    const exists = getOne('SELECT id FROM users WHERE lower(email)=lower(?)', [email]);
    if (exists) return res.status(409).json({ ok: false, error: 'Email already registered.' });

    const hash = await bcrypt.hash(String(password), 10);
    // 插入（注意 sql.js 的 ? 绑定）
    run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name || email.split('@')[0], email, hash]);
    await saveDB();

    const user = getOne('SELECT id, name, email, level, coins, verified FROM users WHERE lower(email)=lower(?)', [email]);
    req.session.user = user;
    res.json({ ok: true, redirect: '/' });
  } catch (e) {
    console.error('Register error:', e);
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Email already registered.' });
    }
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    await getDB();
    const row = getOne('SELECT id, name, email, password_hash, level, coins, verified FROM users WHERE lower(email)=lower(?)', [email]);
    if (!row || !row.password_hash) return res.status(401).json({ ok: false, error: 'Invalid email or password.' });

    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Invalid email or password.' });

    const user = { id: row.id, name: row.name, email: row.email, level: row.level, coins: row.coins, verified: row.verified };
    req.session.user = user;
    res.json({ ok: true, redirect: '/' });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true, redirect: '/' }));
});

/* ------------------------ Games scanning ------------------------ */
let games = new Map();

function stableIdFromFolder(folder) {
  const s = String(folder);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function loadGames() {
  const map = new Map();
  const gamesDir = path.join(__dirname, 'games');
  if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, { recursive: true });
    games = map; return;
  }

  const folders = fs
    .readdirSync(gamesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b));

  folders.forEach(folder => {
    const id = stableIdFromFolder(folder);
    const dir = path.join(gamesDir, folder);

    let meta = {};
    const metaFile = path.join(dir, 'game.json');
    if (fs.existsSync(metaFile)) {
      try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); }
      catch (e) { console.warn(`⚠️ Failed to parse ${path.join('games', folder, 'game.json')}:`, e.message); }
    }

    let entryFile = meta.entryFile || null;
    const candidates = ['index.html', 'game.html', 'main.html', `${folder}.html`];
    if (!entryFile) {
      const picked = candidates.find(f => fs.existsSync(path.join(dir, f)));
      if (picked) entryFile = picked;
    }
    if (!entryFile) {
      const anyHtml = fs.readdirSync(dir).find(f => /\.html?$/i.test(f)) || null;
      if (anyHtml) entryFile = anyHtml;
    }
    if (!entryFile) { console.warn(`⚠️ Skip ${folder}: no HTML entry found`); return; }

    const displayName = (meta.name && String(meta.name).trim())
      ? String(meta.name).trim()
      : folder.replace(/[-_]/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

    const cfg = {
      id, folder,
      name: displayName,
      description: meta.description || `A fun game: ${displayName}`,
      icon: meta.icon || '🎮',
      category: meta.category || 'General',
      difficulty: meta.difficulty || 'medium',
      entryFile
    };
    map.set(id, cfg);
  });

  games = map;
}
loadGames();

app.get('/api/games', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  loadGames();
  res.json({
    ok: true,
    items: Array.from(games.values()).map(g => ({
      id: g.id, name: g.name, description: g.description, icon: g.icon, category: g.category
    }))
  });
});

app.get('/play/:id', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  loadGames();

  const gameId = parseInt(req.params.id, 10);
  const game = games.get(gameId);
  if (!game) { console.warn(`❌ /play/${gameId}: game not found`); return res.redirect('/'); }

  const dir = path.join(__dirname, 'games', game.folder);
  const file = path.join(dir, game.entryFile);
  if (fs.existsSync(file)) return res.sendFile(file);
  console.warn(`❌ Missing entry file: ${path.relative(__dirname, file)} — fallback to static path`);
  if (fs.existsSync(dir)) return res.redirect(`/games/${encodeURIComponent(game.folder)}/${encodeURIComponent(game.entryFile)}`);
  return res.status(404).send('Game not found');
});

/* ------------------------ Health ------------------------ */
app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ------------------------ Start ------------------------ */
app.listen(PORT, async () => {
  await getDB();
  console.log(`✅ Server listening on :${PORT}`);
  console.log(`🗂  Data dir: ${DATA_DIR}`);
  console.log(`🗄  SQLite (sql.js): ${DB_FILE}`);
});
