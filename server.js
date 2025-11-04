// server.js

// 1) imports
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');

// 2) 基础设置
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

// 3) 先创建 app，再做任何 app.use
const app = express();
app.set('trust proxy', 1); // Railway/反向代理后拿正确的 secure cookie

app.use(express.json());

// 4) 准备 Postgres（如果没有 DATABASE_URL，也允许先跑起来）
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL });
}

// 5) 准备 session store（优先 connect-pg-simple，缺失则回退 MemoryStore）
let StoreCtor = null;
try {
  // 注意：connect-pg-simple 是一个函数，需要把 session 传进去
  StoreCtor = require('connect-pg-simple')(session);
} catch (e) {
  console.log('[SESSION] connect-pg-simple not installed, using MemoryStore (DEV ONLY)');
}

// 6) 组装 session 中间件（根据是否有 StoreCtor & pool 决定是否用 PG 存储）
const sessionMiddleware = session({
  store: (StoreCtor && pool)
    ? new StoreCtor({
        pool,
        tableName: 'session', // 你也可以换个名字
        // 可以加上 schemaName: 'public',
      })
    : undefined, // undefined = 默认 MemoryStore（仅开发环境）
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: true, // 在 Railway/HTTPS 反代后建议 true
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 天
  }
});

// 7) 现在才能 app.use(session)
app.use(sessionMiddleware);

// 8) 示例路由
app.get('/healthz', (_req, res) => res.send('ok'));

app.get('/whoami', (req, res) => {
  req.session.views = (req.session.views || 0) + 1;
  res.json({ views: req.session.views });
});

// 9) 启动
app.listen(PORT, () => {
  console.log(`server up on :${PORT}`);
});