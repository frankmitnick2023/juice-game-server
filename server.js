// server.js
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const MemoryStore = session.MemoryStore;
const sessionStore = new MemoryStore();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games'));

// === 数据库初始化 ===
(async () => {
  try {
    // 1. 用户表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        coins INTEGER DEFAULT 0,
        student_name TEXT,
        dob DATE,
        agreed_terms BOOLEAN DEFAULT FALSE,
        total_minutes INTEGER DEFAULT 0
      );
    `);
    // 补丁：确保字段存在
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS student_name TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dob DATE;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS agreed_terms BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_minutes INTEGER DEFAULT 0;`);

    // 2. 课程表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        min_age INTEGER DEFAULT 0,
        max_age INTEGER DEFAULT 99,
        teacher TEXT,
        price DECIMAL(10, 2) DEFAULT 0,
        category TEXT DEFAULT 'General'
      );
    `);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';`);

    // 3. 报名/账单表 (升级：加入价格快照)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        course_id INTEGER REFERENCES courses(id),
        student_name TEXT,
        status TEXT DEFAULT 'UNPAID', -- 状态: UNPAID(待付), PAID(已付)
        price_snapshot DECIMAL(10, 2) DEFAULT 0, -- 记录报名时的价格
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // 补丁
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_snapshot DECIMAL(10, 2) DEFAULT 0;`);

    // 4. 签到日志表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        course_id INTEGER REFERENCES courses(id),
        course_name TEXT,
        category TEXT,
        duration_minutes INTEGER,
        check_in_time TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Database initialized.');
    initFridayCourses(); 

  } catch (err) {
    console.error('DB init error:', err.message);
  }
})();

// === 初始化数据 ===
async function initFridayCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses WHERE day_of_week = 'Friday'");
    if (parseInt(check.rows[0].count) > 0) return; 
    const courses = [
      { name: 'JAZZ 爵士舞团', start: '16:00', end: '17:00', min: 8, max: 99, teacher: 'KATIE', price: 220, cat: 'NZAMD' },
      { name: 'HIPHOP LEVEL 1', start: '16:00', end: '17:00', min: 6, max: 8, teacher: 'NANA', price: 180, cat: 'NZAMD' },
      { name: '进阶提高现代舞', start: '16:00', end: '17:00', min: 9, max: 99, teacher: 'LIZ', price: 200, cat: 'Technique' },
      { name: 'K-POP 韩国流行舞 (少儿)', start: '17:00', end: '18:00', min: 8, max: 10, teacher: 'JISOO', price: 180, cat: 'General' },
      { name: '芭蕾&现代舞舞团 (排练)', start: '18:00', end: '19:00', min: 11, max: 99, teacher: 'TONIA', price: 220, cat: 'Performance' }
    ];
    for (const c of courses) {
      await pool.query(
        `INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, category) 
         VALUES ($1, 'Friday', $2, $3, $4, $5, $6, $7, $8)`,
        [c.name, c.start, c.end, c.min, c.max, c.teacher, c.price, c.cat]
      );
    }
    console.log('✅ 周五课表录入完成');
  } catch (e) { console.error(e); }
}

// === 核心业务逻辑 API ===

// 注册
app.post('/api/register', async (req, res) => {
  const { email, password, studentName, dob, agreedToTerms } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, student_name, dob, agreed_terms) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, level, coins, student_name`,
      [email, hash, studentName || null, dob || null, agreedToTerms || false]
    );
    req.session.user = result.rows[0];
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// 登录
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    delete user.password_hash;
    req.session.user = user;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// 智能选课推荐
app.get('/api/courses/recommended', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  try {
    const userRes = await pool.query('SELECT dob FROM users WHERE id = $1', [req.session.user.id]);
    if (!userRes.rows[0].dob) return res.status(400).json({ error: '请先完善生日信息' });
    
    const dob = new Date(userRes.rows[0].dob);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;

    const coursesRes = await pool.query(
      `SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, 
      [age]
    );
    res.json({ age: age, courses: coursesRes.rows });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

// 核心：报名 + 自动生成 Invoice (Updated)
app.post('/api/book-course', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  const { courseId } = req.body;
  try {
    // 查重
    const check = await pool.query('SELECT * FROM bookings WHERE user_id = $1 AND course_id = $2', [req.session.user.id, courseId]);
    if (check.rows.length > 0) return res.json({ success: false, message: '已报名，请查看账单' });

    // 获取当前价格和学生名
    const cRes = await pool.query('SELECT price FROM courses WHERE id = $1', [courseId]);
    const uRes = await pool.query('SELECT student_name FROM users WHERE id = $1', [req.session.user.id]);
    
    const price = cRes.rows[0].price;
    const studentName = uRes.rows[0].student_name;

    // 创建订单 (生成 Invoice 记录)
    await pool.query(
        `INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, status) 
         VALUES ($1, $2, $3, $4, 'UNPAID')`, 
        [req.session.user.id, courseId, studentName, price]
    );
    
    res.json({ success: true, message: '报名成功！Invoice 已生成。' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// 新增：获取我的账单列表
app.get('/api/my-invoices', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '未登录' });
    try {
        const result = await pool.query(`
            SELECT b.id, b.status, b.price_snapshot, b.created_at, c.name as course_name, c.day_of_week, c.start_time 
            FROM bookings b
            JOIN courses c ON b.course_id = c.id
            WHERE b.user_id = $1
            ORDER BY b.created_at DESC
        `, [req.session.user.id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json({error: '获取账单失败'}); }
});

// === 老师端 API ===
app.get('/api/teacher/courses', async (req, res) => {
  const result = await pool.query('SELECT * FROM courses ORDER BY day_of_week, start_time');
  res.json(result.rows);
});

app.get('/api/teacher/bookings/:courseId', async (req, res) => {
  const { courseId } = req.params;
  const result = await pool.query(
    `SELECT b.id, b.status, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.course_id = $1`,
    [courseId]
  );
  res.json(result.rows);
});

app.post('/api/teacher/check-in', async (req, res) => {
  const { bookingId, courseId } = req.body;
  try {
    const cRes = await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id = $1', [courseId]);
    const c = cRes.rows[0];
    const [sH, sM] = c.start_time.split(':').map(Number);
    const [eH, eM] = c.end_time.split(':').map(Number);
    const duration = (eH * 60 + eM) - (sH * 60 + sM); 

    const bRes = await pool.query('SELECT user_id FROM bookings WHERE id = $1', [bookingId]);
    const userId = bRes.rows[0].user_id;

    // 写入签到日志
    await pool.query(
        `INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, courseId, c.name, c.category, duration]
    );

    // 增加时长
    await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]);
    
    // 注意：这里不更新 booking status 为 attended，因为 booking 状态现在用于支付 (UNPAID/PAID)
    // 如果需要标记签到，可以在 bookings 表加个 last_check_in 字段，但目前为了简单，我们只记录 logs

    res.json({ success: true, added_minutes: duration });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

// 游戏 API (Mock)
function scanGames() { return []; } 
let gameCache = null; 

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/timetable.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'timetable.html')));
app.get('/invoices.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoices.html'))); // 新增
app.get('/teacher.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));