// server.js - Juice Game 舞蹈游戏平台 (Railway HTTPS 适配修复版)
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
const isProduction = process.env.NODE_ENV === 'production';

// === 关键修复 1: 信任代理 ===
// Railway 位于反向代理之后，必须开启此选项，否则 Cookie 无法在 HTTPS 下写入
app.set('trust proxy', 1);

// === PostgreSQL 连接池 ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// === 中间件配置 ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === 关键修复 2: Session 配置 ===
app.use(session({
  secret: 'juice-game-secret-key-2025', 
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24小时
    // 在 Railway (Production) 环境下必须为 true，否则浏览器会因为跨协议问题丢弃 Cookie
    secure: isProduction, 
    // 配合 secure: true 使用，防止浏览器拦截跨站请求
    sameSite: isProduction ? 'none' : 'lax',
    httpOnly: true
  }
}));

app.use(express.static('public'));
app.use('/games', express.static('games'));

// === 辅助函数 ===
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
      // 注册成功自动登录
      req.session.user = result.rows[0];
      req.session.save(); // 强制保存
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
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });

  const emailNorm = normalizeEmail(email);

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, level, coins FROM users WHERE lower(email) = $1`,
      [emailNorm]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: '密码错误' });
    }

    delete user.password_hash;
    
    // 保存 Session
    req.session.user = user;
    
    // 手动 save 确保 Cookie 写入后再返回响应
    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: '登录失败' });
      }
      console.log('登录成功，Session已写入:', user.email);
      return res.json({ message: '登录成功', user });
    });

  } catch (err) {
    console.error('登录错误:', err);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// === API: 获取当前状态 ===
app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ user: req.session.user });
  }
  res.status(401).json({ user: null, message: "未登录" });
});

// === API: 退出登录 ===
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
    console.error('清单读取错误:', err);
    res.status(500).json({ error: '加载失败' });
  }
});

// === 路由 ===
app.get('/play/:id', (req, res) => {
  const { id } = req.params;
  // 增加简单的安全检查
  if (id.includes('..')) return res.status(403).send('Access denied');

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

// === 启动 ===
const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
  });
};

pool.connect()
  .then(client => {
    console.log('✅ DB Connected');
    client.release();
    startServer();
  })
  .catch(err => {
    console.error('⚠️ DB Error:', err.message);
    startServer();
  });