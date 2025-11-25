// server.js
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
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
    // 用户表
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
    // 字段补丁
    const userCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0'];
    for (const col of userCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`);

    // 课程表 (增加单节课价格 casual_price)
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
        price DECIMAL(10, 2) DEFAULT 0,       -- 整学期价格
        casual_price DECIMAL(10, 2) DEFAULT 0,-- 单节课价格
        category TEXT DEFAULT 'General'
      );
    `);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price DECIMAL(10, 2) DEFAULT 0`);

    // 报名表 (增加类型和日期记录)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        course_id INTEGER REFERENCES courses(id),
        student_name TEXT,
        status TEXT DEFAULT 'UNPAID',
        price_snapshot DECIMAL(10, 2) DEFAULT 0,
        booking_type TEXT DEFAULT 'term',  -- 'term' 或 'casual'
        selected_dates TEXT,               -- 存逗号分隔的日期字符串
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'term'`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_dates TEXT`);

    // 签到日志表
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
    initAllCourses(); // 初始化全量课表

  } catch (err) {
    console.error('DB init error:', err.message);
  }
})();

// === 全量课表录入 (基于图片) ===
async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return; // 简单防重，如果数据够多就不插了

    console.log('正在初始化 2026 全量课表...');
    
    // 默认单节课价格 (假设)
    const CASUAL_BASE = 25; 

    const courses = [
      // === MONDAY ===
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心与技巧', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', p:180, c:'Technique' },
      { d:'Monday', n:'OPEN 芭蕾技巧与基础', s:'16:00', e:'17:00', min:5, max:8, t:'CARRIE', p:180, c:'Ballet' },
      { d:'Monday', n:'英皇芭蕾3级', s:'18:00', e:'19:00', min:9, max:99, t:'LIU', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 舞团班', s:'19:00', e:'20:00', min:12, max:99, t:'CINDY', p:220, c:'Performance' },

      // === TUESDAY ===
      { d:'Tuesday', n:'英皇芭蕾4级', s:'16:00', e:'17:00', min:9, max:10, t:'DEMI', p:200, c:'RAD' },
      { d:'Tuesday', n:'软开度/核心与技巧', s:'16:00', e:'17:00', min:7, max:8, t:'CINDY', p:180, c:'Technique' },
      { d:'Tuesday', n:'英皇芭蕾2级', s:'17:00', e:'18:00', min:7, max:8, t:'DEMI', p:200, c:'RAD' },
      { d:'Tuesday', n:'RAD INTERMEDIATE FOUNDATION', s:'18:00', e:'19:00', min:10, max:13, t:'DEMI', p:220, c:'RAD' },
      { d:'Tuesday', n:'OPEN 芭蕾足尖课', s:'19:00', e:'20:00', min:10, max:15, t:'TONIA', p:200, c:'Ballet' },

      // === WEDNESDAY ===
      { d:'Wednesday', n:'英皇芭蕾1级', s:'16:00', e:'17:00', min:7, max:99, t:'CARRIE', p:200, c:'RAD' },
      { d:'Wednesday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Wednesday', n:'HIPHOP LEVEL 2', s:'17:00', e:'18:00', min:9, max:15, t:'NANA', p:180, c:'HipHop' },
      { d:'Wednesday', n:'OPEN 现代舞基础', s:'18:00', e:'19:00', min:7, max:9, t:'ASA', p:180, c:'Contemporary' },

      // === THURSDAY ===
      { d:'Thursday', n:'基础软开与核心训练', s:'16:00', e:'17:00', min:5, max:6, t:'DEMI', p:180, c:'Technique' },
      { d:'Thursday', n:'DANCE TROUPE MUSICAL', s:'17:00', e:'18:00', min:4, max:6, t:'TARNIA', p:180, c:'Performance' },
      { d:'Thursday', n:'英皇芭蕾5级', s:'18:00', e:'19:00', min:9, max:10, t:'DEMI', p:200, c:'RAD' },
      { d:'Thursday', n:'HIPHOP 提高班', s:'18:30', e:'20:00', min:9, max:15, t:'NANA', p:220, c:'HipHop' },

      // === FRIDAY ===
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:220, c:'Jazz' },
      { d:'Friday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Friday', n:'K-POP 韩国流行舞', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:180, c:'Kpop' },
      { d:'Friday', n:'K-POP 韩国流行舞', s:'18:00', e:'19:30', min:11, max:16, t:'JISOO', p:220, c:'Kpop' },

      // === SATURDAY ===
      { d:'Saturday', n:'英皇芭蕾 PRIMARY', s:'09:30', e:'11:00', min:5, max:6, t:'CARRIE', p:220, c:'RAD' },
      { d:'Saturday', n:'幼儿芭蕾启蒙班', s:'11:00', e:'12:00', min:3, max:5, t:'DEMI', p:180, c:'Ballet' },
      { d:'Saturday', n:'K-POP', s:'11:00', e:'12:30', min:11, max:16, t:'HAZEL', p:220, c:'Kpop' },
      { d:'Saturday', n:'NZAMD 爵士考级 L1', s:'12:00', e:'13:00', min:5, max:6, t:'KATIE', p:200, c:'Jazz' },
      { d:'Saturday', n:'PBT 进阶芭蕾技巧', s:'13:00', e:'14:00', min:7, max:8, t:'CARRIE', p:180, c:'Technique' },

      // === SUNDAY ===
      { d:'Sunday', n:'英皇芭蕾 GRADE 1', s:'09:30', e:'10:30', min:7, max:99, t:'CARRIE', p:200, c:'RAD' },
      { d:'Sunday', n:'PBT 芭蕾技巧', s:'10:30', e:'11:30', min:5, max:7, t:'CARRIE', p:180, c:'Technique' },
      { d:'Sunday', n:'OPEN 软开核心', s:'10:00', e:'11:00', min:9, max:99, t:'FORREST', p:180, c:'Technique' }
    ];

    for (const c of courses) {
      // 插入数据 (如果 casual_price 没写，默认为 TermPrice / 8)
      const casual = c.cp || Math.ceil(c.p / 8); 
      await pool.query(
        `INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, casual, c.c]
      );
    }
    console.log('✅ 2026 完整课表初始化完成');
  } catch (e) { console.error(e); }
}

// === 业务 API ===

// 注册/登录/登出 (保持不变)
app.post('/api/register', async (req, res) => { /* 同前... */ const { email, password, studentName, dob, agreedToTerms } = req.body; if (!email || !password) return res.status(400).json({ error: 'Missing fields' }); try { const hash = await bcrypt.hash(password, 10); const result = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob, agreed_terms) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, level, coins, student_name`, [email, hash, studentName || null, dob || null, agreedToTerms || false]); req.session.user = result.rows[0]; res.json(result.rows[0]); } catch (err) { if (err.code === '23505') return res.status(400).json({ error: 'Email exists' }); res.status(500).json({ error: 'Server error' }); } });
app.post('/api/login', async (req, res) => { /* 同前... */ const { email, password } = req.body; try { const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]); const user = result.rows[0]; if (!user || !(await bcrypt.compare(password, user.password_hash))) { return res.status(401).json({ error: 'Invalid credentials' }); } delete user.password_hash; req.session.user = user; res.json(user); } catch (err) { res.status(500).json({ error: 'Server error' }); } });
app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// 获取课程 (包含价格信息)
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

// 核心：报名 (支持 Term 和 Casual)
app.post('/api/book-course', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  const { courseId, type, selectedDates, totalPrice } = req.body; 
  // type: 'term' | 'casual'
  // selectedDates: ['2026-02-02', '2026-02-09'] (数组)
  
  try {
    // 查重 (如果是整学期报名，不允许重复；casual 允许加报)
    if (type === 'term') {
        const check = await pool.query("SELECT * FROM bookings WHERE user_id = $1 AND course_id = $2 AND booking_type = 'term'", [req.session.user.id, courseId]);
        if (check.rows.length > 0) return res.json({ success: false, message: '您已报名该课程整学期' });
    }

    const uRes = await pool.query('SELECT student_name FROM users WHERE id = $1', [req.session.user.id]);
    const studentName = uRes.rows[0].student_name;
    const datesStr = selectedDates ? selectedDates.join(',') : '';

    // 写入订单
    await pool.query(
        `INSERT INTO bookings 
         (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status) 
         VALUES ($1, $2, $3, $4, $5, $6, 'UNPAID')`, 
        [req.session.user.id, courseId, studentName, totalPrice, type, datesStr]
    );
    
    res.json({ success: true, message: '报名成功！Invoice 已生成。' });
  } catch (e) { 
      console.error(e);
      res.status(500).json({ error: 'Failed' }); 
  }
});

// 获取账单
app.get('/api/my-invoices', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '未登录' });
    try {
        const result = await pool.query(`
            SELECT b.*, c.name as course_name, c.day_of_week, c.start_time 
            FROM bookings b
            JOIN courses c ON b.course_id = c.id
            WHERE b.user_id = $1
            ORDER BY b.created_at DESC
        `, [req.session.user.id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json({error: 'Error'}); }
});

// 老师 API (保持)
app.get('/api/teacher/courses', async (req, res) => {
  const result = await pool.query('SELECT * FROM courses ORDER BY day_of_week, start_time');
  res.json(result.rows);
});
app.get('/api/teacher/bookings/:courseId', async (req, res) => {
  const { courseId } = req.params;
  const result = await pool.query(
    `SELECT b.id, b.status, u.student_name, u.total_minutes, b.booking_type, b.selected_dates 
     FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.course_id = $1`,
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
    await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes) VALUES ($1, $2, $3, $4, $5)`, [userId, courseId, c.name, c.category, duration]);
    await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]);
    res.json({ success: true, added_minutes: duration });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// Mock Game
function scanGames() { return []; } let gameCache = null; 
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/timetable.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'timetable.html')));
app.get('/invoices.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoices.html')));
app.get('/teacher.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teacher.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));