// server.js - Juice Game 舞蹈游戏平台主服务
require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs'); // 使用已安装的 bcryptjs
const { Pool } = require('pg');
const fs = require('fs');

// === 初始化 ===
const app = express();
const PORT = process.env.PORT || 3000;

// === PostgreSQL 连接池 ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway 的 Postgres 需要 SSL 连接
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === 中间件 ===
app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games')); // 静态托管 games 目录

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
    
    // 尝试插入用户
    // 注意：这里假设你的数据库表有 level 和 coins 字段，如果没有会自动忽略报错或你需要调整SQL
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, level, coins)
       VALUES ($1, $2, 1, 100)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, level, coins`,
      [emailNorm, hash]
    );

    if (result.rowCount > 0) {
      return res.status(201).json({ message: '注册成功', user: result.rows[0] });
    }

    // 如果插入不成功（冲突），则查询现有用户
    const existing = await pool.query(
      `SELECT id, email, level, coins FROM users WHERE lower(email) = $1`,
      [emailNorm]
    );
    return res.status(200).json({ message: '用户已存在', user: existing.rows[0] });

  } catch (err) {
    console.error('注册失败:', err);
    // 捕获唯一约束错误等
    if (err.code === '23505') { // unique_violation
        return res.status(400).json({ error: '该邮箱已被注册' });
    }
    return res.status(500).json({ error: '服务器错误，请稍后再试' });
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

    // 移除密码哈希后返回用户信息
    delete user.password_hash;
    
    // 登录成功！
    return res.json({ message: '登录成功', user });

  } catch (err) {
    console.error('登录失败:', err);
    return res.status(500).json({ error: '数据库连接失败' });
  }
});

// === API: 获取当前用户状态 (修复 404 报错) ===
// 由于目前去掉了 session 依赖，这个接口主要用于防止前端报错
// 如果前端代码依赖这个接口判断登录状态，它会收到 401，从而提示用户去登录
app.get('/api/me', (req, res) => {
  res.status(401).json({ user: null, message: "No active session" });
});

// === API: 获取游戏列表 ===
app.get('/api/games', async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'games', 'game-manifest.json');
    const data = await fs.promises.readFile(manifestPath, 'utf-8');
    const games = JSON.parse(data);

    // 补充完整 URL
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

// === 播放页面路由 ===
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
  res.status(404).send('游戏文件不存在');
});

// === 首页路由 ===
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('Juice Game Server Running! (No index.html found in public folder)');
    }
});

// === 启动服务器 ===
const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

// 尝试连接数据库，即使失败也启动 Web 服务以便调试
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL Database Connected Successfully');
    client.release();
    startServer();
  })
  .catch(err => {
    console.error('⚠️ Database Connection Failed:', err.message);
    console.log('⚠️ Starting server in NO-DB mode (Login will not work, but games might load)');
    startServer();
  });