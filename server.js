// server.js - Juice Game 舞蹈游戏平台主服务
require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const fs = require('fs'); // 修正：直接引用 fs，后续按需使用 promises

// === 初始化 ===
const app = express();
const PORT = process.env.PORT || 3000;

// === PostgreSQL 连接池 ===
// 注意：如果是无数据库模式启动，pool 操作会报错，所以我们在 API 里做了 try-catch
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
    return res.status(500).json({ error: '注册失败，可能是数据库连接问题' });
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
    return res.status(500).json({ error: '登录失败，可能是数据库连接问题' });
  }
});

// === API: 获取游戏列表 ===
app.get('/api/games', async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
    // 使用 fs.promises 读取
    const data = await fs.promises.readFile(manifestPath, 'utf-8');
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
  // 这里的路径构建要小心，防止目录遍历攻击（简单 demo 暂不处理）
  const filePath = path.join(__dirname, 'games', id, 'index.html');
  const singlePath = path.join(__dirname, 'games', `${id}.html`);

  // 使用同步方法检查文件是否存在
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  if (fs.existsSync(singlePath)) {
    return res.sendFile(singlePath);
  }
  res.status(404).send('游戏不存在，请检查路径配置');
});

// === 首页 & 静态页面 ===
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// 如果你有 games.html 也可以保留，没有则不需要
app.get('/games', (req, res) => {
    const p = path.join(__dirname, 'public', 'games.html');
    if(fs.existsSync(p)) res.sendFile(p);
    else res.send("游戏列表页正在建设中...");
});

// === 启动服务器逻辑 (容错版) ===
const startServer = () => {
  app.listen(PORT, () => {
    console.log(`🚀 Juice Game 平台运行在 http://localhost:${PORT}`);
    console.log(`🌐 部署地址: ${process.env.RAILWAY_STATIC_URL || '本地'}`);
  });
};

// 尝试连接数据库，但无论成功与否都启动 Web 服务
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL 连接成功');
    client.release();
    startServer();
  })
  .catch(err => {
    console.error('⚠️ 数据库连接失败:', err.message);
    console.log('⚠️ 系统将以【无数据库模式】启动，登录功能将不可用，但游戏可以访问。');
    startServer();
  });