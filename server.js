// server.js - Juice Game (CORS + Session 终极修正版)
require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const session = require('express-session');
const cors = require('cors'); // 新增：引入 CORS

// === 初始化 ===
const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// === 1. 信任代理 (必须放在最前面) ===
app.set('trust proxy', 1);

// === 2. CORS 配置 (允许携带凭证) ===
app.use(cors({
  origin: true, // 自动匹配请求来源
  credentials: true // 允许发送 Cookie
}));

// === PostgreSQL 连接池 ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// === 中间件 ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 3. Session 配置 (Lax + Secure) ===
app.use(session({
  secret: 'juice-game-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24小时
    secure: true, // Railway 强制 HTTPS，必须为 true
    sameSite: 'lax', // Lax 是最稳定的现代标准，兼顾安全与兼容
    httpOnly: true
  }
}));

// 调试中间件
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    const userEmail = req.session?.user?.email || '未登录';
    console.log(`📡 [${req.method}] ${req.url} | User: ${userEmail} | ID: ${req.sessionID}`);
  }
  next();
});

app.use(express.static('public'));
app.use('/games', express.static('games'));

const normalizeEmail = (email) => email?.toLowerCase().trim();

// === API: 注册 ===
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });
  
  const emailNorm = normalizeEmail(email);
  
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, level, coins)
       VALUES ($1, $2, 1, 100)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, level, coins`,
      [emailNorm, hash]
    );

    if (result.rowCount > 0) {
      req.session.user = result.rows[0];
      req.session.save();
      return res.status(201).json({ message: '注册成功', user: result.rows[0] });
    }

    const existing = await pool.query(
      `SELECT id, email, level, coins FROM users WHERE lower(email) = $1`,
      [emailNorm]
    );
    return res.status(200).json({ message: '用户已存在', user: existing.rows[0] });

  } catch (err) {
    console.error('注册错误:', err);
    return res.status(500).json({ error: '注册失败' });
  }
});

// === API: 登录 (简化版) ===
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '参数缺失' });

  const emailNorm = normalizeEmail(email);

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, level, coins FROM users WHERE lower(email) = $1`,
      [emailNorm]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: '用户不存在' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: '密码错误' });

    delete user.password_hash;
    
    // 直接赋值 Session (不使用 regenerate 以避免竞态条件)
    req.session.user = user;
    
    // 强制保存
    req.session.save((err) => {
      if (err) {
        console.error('Session保存失败:', err);
        return res.status(500).json({ error: '登录失败' });
      }
      console.log(`✅ 登录成功: ${user.email}`);
      return res.json({ message: '登录成功', user });
    });

  } catch (err) {
    console.error('登录错误:', err);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// === API: 获取当前用户 ===
app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ user: req.session.user });
  }
  res.status(401).json({ user: null, message: "未登录" });
});

// === 新增：Session 调试接口 ===
// 如果登录失败，在浏览器直接访问 /api/debug-session 看看显示什么
app.get('/api/debug-session', (req, res) => {
  res.json({
    sessionID: req.sessionID,
    hasUser: !!(req.session && req.session.user),
    user: req.session?.user || null,
    cookie: req.session?.cookie
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: '已退出' });
});

app.get('/api/games', async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
    if (!fs.existsSync(manifestPath)) return res.json([]);
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
    console.error(err);
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/play/:id', (req, res) => {
  const { id } = req.params;
  const filePath = path.join(__dirname, 'games', id, 'index.html');
  const singlePath = path.join(__dirname, 'games', `${id}.html`);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  if (fs.existsSync(singlePath)) return res.sendFile(singlePath);
  res.status(404).send('Game not found');
});

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.send('Server Running');
});

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

pool.connect().then(client => {
  console.log('✅ DB Connected');
  client.release();
  startServer();
}).catch(err => {
  console.error('DB Failed:', err);
  startServer();
});