// server.js - Juice Game (终极修复版：强制HTTPS+跨域兼容)
require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const session = require('express-session');

// === 初始化 ===
const app = express();
const PORT = process.env.PORT || 3000;

// === 关键修复 1: 必须信任 Railway 的反向代理 ===
// 没有这一行，Express 认为连接是 HTTP，从而拒绝发送 Secure Cookie
app.set('trust proxy', 1);

// === PostgreSQL 连接池 ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === 中间件 ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 关键修复 2: 强力 Session 配置 ===
app.use(session({
  secret: 'juice-game-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  proxy: true, // 强制允许代理
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24小时
    // 无论本地还是线上，只要是 Railway 环境都强制 Secure
    // 注意：Secure: true 要求网站必须是 HTTPS (Railway 默认就是)
    secure: true, 
    // 'none' + 'secure' 是最不容易被浏览器拦截的组合
    sameSite: 'none',
    httpOnly: true
  }
}));

// === 调试中间件：监控 Cookie 是否成功传输 ===
app.use((req, res, next) => {
  // 只监控 API 请求
  if (req.url.startsWith('/api/')) {
    const hasSession = req.session && req.session.user;
    console.log(`📡 [${req.method}] ${req.url} | SessionID: ${req.sessionID} | 用户: ${hasSession ? req.session.user.email : '未登录'}`);
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
      await new Promise((resolve) => req.session.save(resolve)); // 等待保存完成
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

// === API: 登录 ===
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '缺少参数' });

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
    
    // 重新生成 Session 以防止固定攻击，并强制保存
    req.session.regenerate(async (err) => {
        if (err) return res.status(500).json({ error: 'Session生成失败' });
        
        req.session.user = user;
        
        // 手动保存，确保 Cookie 在响应头里
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: 'Session保存失败' });
            console.log(`✅ 登录成功: ${user.email} | SessionID: ${req.sessionID}`);
            return res.json({ message: '登录成功', user });
        });
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
  // 这里返回 401 导致了你的页面跳转，如果 Session 没存住，就会一直 401
  res.status(401).json({ user: null, message: "未登录" });
});

// === API: 退出 ===
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: '已退出' });
});

// === API: 游戏列表 ===
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
    console.error('清单错误:', err);
    res.status(500).json({ error: '列表加载失败' });
  }
});

// === 路由 ===
app.get('/play/:id', (req, res) => {
  const { id } = req.params;
  if (id.includes('..')) return res.status(403).send('Denied');
  const filePath = path.join(__dirname, 'games', id, 'index.html');
  const singlePath = path.join(__dirname, 'games', `${id}.html`);
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  if (fs.existsSync(singlePath)) return res.sendFile(singlePath);
  res.status(404).send('Game not found');
});

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) res.sendFile(indexPath);
    else res.send('Juice Game Server Running');
});

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

pool.connect()
  .then(client => {
    console.log('✅ DB Connected');
    client.release();
    startServer();
  })
  .catch(err => {
    console.error('⚠️ DB Failed:', err.message);
    startServer();
  });