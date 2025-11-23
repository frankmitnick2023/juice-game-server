// server.js - Juice Game 舞蹈游戏平台主服务
require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const fs = require('fs').promises;

// === 初始化 ===
const app = express();
const PORT = process.env.PORT || 3000;

// === PostgreSQL 连接池 ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === 中间件 ===
app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games')); // 关键：静态托管 games 目录

// === 辅助函数 ===
const normalizeEmail = (email) => email?.toLowerCase().trim();

// === API: 注册 ===
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });

  const emailNorm = normalizeEmail(email);
  const hash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, level, coins)
       VALUES ($1, $2, 1, 100)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id, email, level, coins`,
      [emailNorm, hash]
    );

    if (result.rowCount > 0) {
      return res.status(201).json({ message: '注册成功', user: result.rows[0] });
    }

    // 已存在 → 返回用户
    const existing = await pool.query(
      `SELECT id, email, level, coins FROM users WHERE lower(email) = $1`,
      [emailNorm]
    );
    return res.status(200).json({ message: '用户已存在', user: existing.rows[0] });

  } catch (err) {
    console.error('注册失败:', err);
    return res.status(500).json({ error: '服务器错误' });
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

    // 移除密码后返回
    delete user.password_hash;
    return res.json({ message: '登录成功', user });

  } catch (err) {
    console.error('登录失败:', err);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// === API: 获取游戏列表 ===
app.get('/api/games', async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
    const data = await fs.readFile(manifestPath, 'utf-8');
    const games = JSON.parse(data);

    // 补充完整 URL（适配 Railway 部署）
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const enriched = games.map(game => ({
      ...game,
      url: game.type === 'single'
        ? `${baseUrl}/games/${game.id}.html`
        : `${baseUrl}/games/${game.id}/index.html`
    }));

    res.json(enriched);
  } catch (err) {
    console.error('读取游戏清单失败:', err);
    res.status(500).json({ error: '游戏列表加载失败' });
  }
});

// === 播放页面路由：/play/:id ===
app.get('/play/:id', (req, res) => {
  const { id } = req.params;
  const filePath = path.join(__dirname, 'games', id, 'index.html');
  const singlePath = path.join(__dirname, 'games', `${id}.html`);

  // 优先文件夹游戏
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  if (fs.existsSync(singlePath)) {
    return res.sendFile(singlePath);
  }
  res.status(404).send('游戏不存在');
});

// === 首页 & 静态页面 ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));

// === 启动服务器 ===
pool.connect()
  .then(client => {
    console.log('PostgreSQL 连接成功');
    client.release();
    app.listen(PORT, () => {
      console.log(`Juice Game 平台运行在 http://localhost:${PORT}`);
      console.log(`部署地址: ${process.env.RAILWAY_STATIC_URL || '本地'}`);
    });
  })
  .catch(err => {
    console.error('数据库连接失败:', err);
    process.exit(1);
  });