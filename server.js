/**
 * FunX / Juice Game Server — fixed version
 * - Trust proxy + secure cookie 'auto' + sameSite=lax（Railway/HTTPS 下会话可用）
 * - /register 和 /login 走单页路由，点击“没反应”的问题用前端显式跳转解决
 * - 游戏目录用真实 folder 字段定位，避免大小写导致的 404
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// --- 安全 / 代理设置（Railway 必开） ---
app.set('trust proxy', 1);

// --- 解析中间件 ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// --- 静态资源 ---
// 公开 games 目录（访问 /games/...）
app.use('/games', express.static(path.join(__dirname, 'games')));
// 可选：如果有 /public 目录，这里暴露
if (fs.existsSync(path.join(__dirname, 'public'))) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// --- 会话 ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: 'auto',   // HTTP=false / HTTPS=true
      sameSite: 'lax',  // 允许跨站回跳
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 天
    },
  })
);

// --- 简单用户存储（文件持久化 /data/users.json） ---
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function writeUsers(list) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf8');
}
function findUserByEmail(email) {
  return readUsers().find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}

// --- 动态加载游戏 ---
let games = new Map();

function loadGames() {
  const map = new Map();
  const gamesDir = path.join(__dirname, 'games');
  if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, { recursive: true });
    games = map;
    return;
  }

  const folders = fs
    .readdirSync(gamesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  folders.forEach((folder, i) => {
    const id = i + 1;

    // 展示名：把中划线转空格并首字母大写
    const displayName = folder
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());

    const cfg = {
      id,
      folder, // 真实目录名（关键！用来拼物理路径）
      name: displayName, // 展示名
      description: `A fun game: ${displayName}`,
      icon: '🎮',
      category: 'General',
      entryFile: 'index.html',
    };

    // 自动识别入口文件
    const candidates = ['index.html', 'game.html', 'main.html', `${folder}.html`];
    const found = candidates.find((f) => fs.existsSync(path.join(gamesDir, folder, f)));
    if (found) cfg.entryFile = found;

    map.set(id, cfg);
  });

  games = map;
}

// 初始化一次
loadGames();

// --- 小工具：统一返回 index.html（单页路由） ---
function sendIndex(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
}

// --- 路由：单页视图 ---
app.get('/', sendIndex);
app.get('/login', sendIndex);
app.get('/register', sendIndex);

// --- API：当前用户 ---
app.get('/api/me', (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, user: null });
  res.json({ ok: true, user: u });
});

// --- API：注册 ---
app.post('/api/register', async (req, res) => {
  try {
    const { name = '', email = '', password = '' } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password are required.' });
    }
    if (findUserByEmail(email)) {
      return res.status(409).json({ ok: false, error: 'Email already registered.' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const users = readUsers();
    const newUser = {
      id: users.length ? Math.max(...users.map((u) => u.id || 0)) + 1 : 1,
      name: name || email.split('@')[0],
      email,
      passwordHash: hash,
      level: 1,
      coins: 0,
    };
    users.push(newUser);
    writeUsers(users);

    // 建立会话
    req.session.user = { id: newUser.id, name: newUser.name, email: newUser.email, level: newUser.level, coins: newUser.coins };
    res.json({ ok: true, redirect: '/' });
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// --- API：登录 ---
app.post('/api/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    const user = findUserByEmail(email);
    if (!user) return res.status(401).json({ ok: false, error: 'Invalid email or password.' });

    const match = await bcrypt.compare(String(password), user.passwordHash);
    if (!match) return res.status(401).json({ ok: false, error: 'Invalid email or password.' });

    req.session.user = { id: user.id, name: user.name, email: user.email, level: user.level, coins: user.coins };
    res.json({ ok: true, redirect: '/' });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// --- API：登出 ---
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true, redirect: '/' });
  });
});

// --- API：游戏列表（需登录） ---
app.get('/api/games', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  // 每次请求都 reload 一下，方便你热插拔游戏
  loadGames();
  res.json({
    ok: true,
    items: Array.from(games.values()).map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      icon: g.icon,
      category: g.category,
    })),
  });
});

// --- 播放游戏（需登录） ---
app.get('/play/:id', (req, res) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login');

  const gameId = parseInt(req.params.id, 10);
  const game = games.get(gameId);
  if (!game) return res.redirect('/');

  // 重要：用真实的 folder + entryFile 拼物理路径
  const gameFile = path.join(__dirname, 'games', game.folder, game.entryFile);
  if (!fs.existsSync(gameFile)) return res.status(404).send('Game not found');
  res.sendFile(gameFile);
});

// --- 健康检查 ---
app.get('/healthz', (req, res) => res.json({ ok: true }));

// --- 启动 ---
app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
