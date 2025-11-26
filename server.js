const express = require('express');
const { Pool } = require('pg'); // 切换为 PG
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');

const app = express();

// 连接 Railway 提供的 Postgres 数据库
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Railway 需要 SSL
});

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// --- 数据库初始化 & 自动升级 (Auto Migration) ---
async function initDB() {
  const client = await pool.connect();
  try {
    // 1. 创建基础表 (如果不存在)
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      student_name TEXT,
      dob DATE,
      level INTEGER DEFAULT 1,
      makeup_credits INTEGER DEFAULT 0,
      avatar_config TEXT
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      name TEXT,
      day_of_week TEXT,
      start_time TEXT,
      end_time TEXT,
      teacher TEXT,
      price REAL,
      casual_price REAL,
      classroom TEXT,
      age_group TEXT
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      course_id INTEGER,
      total_price REAL,
      status TEXT DEFAULT 'UNPAID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS trophies (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      image_path TEXT,
      extra_images TEXT,
      source_name TEXT,
      trophy_type TEXT, 
      status TEXT DEFAULT 'PENDING', 
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // 2. 补全字段 (针对旧的 Postgres 数据库可能缺少的字段)
    // 就算报错也不影响，说明字段已存在
    const migrationQueries = [
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS type TEXT`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dates TEXT`,
      `ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price REAL`,
      `ALTER TABLE courses ADD COLUMN IF NOT EXISTS classroom TEXT`,
      `ALTER TABLE courses ADD COLUMN IF NOT EXISTS age_group TEXT`
    ];

    for (const q of migrationQueries) {
      try { await client.query(q); } catch (e) { console.log('Migration note:', e.message); }
    }

    // 3. 种子数据 (如果课程表是空的)
    const { rows } = await client.query("SELECT count(*) as count FROM courses");
    if (parseInt(rows[0].count) === 0) {
      console.log("Seeding courses...");
      const courses = [
        {name: 'Ballet Grade 1', day: 'Monday', start: '16:00', end: '17:00', t: 'Miss A', p: 230, c: 'Studio 1', age: '6-8'},
        {name: 'Jazz Junior', day: 'Monday', start: '17:00', end: '18:00', t: 'Miss B', p: 230, c: 'Studio 2', age: '6-8'},
        {name: 'HipHop Level 1', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Studio 3', age: '6-10'},
        {name: 'K-Pop Kids', day: 'Saturday', start: '10:00', end: '11:00', t: 'Mike', p: 240, c: 'Studio 1', age: '8-12'}
      ];
      for (const c of courses) {
        await client.query(
          "INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [c.name, c.day, c.start, c.end, c.t, c.p, 25, c.c, c.age]
        );
      }
    }

  } catch (err) {
    console.error('DB Init Error:', err);
  } finally {
    client.release();
  }
}
initDB();

// --- 辅助工具 ---
function calculateAge(dob) {
  if (!dob) return 7; // 默认年龄
  const diff = Date.now() - new Date(dob).getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

function requireLogin(req, res, next) {
  if (req.session.userId) next();
  else res.status(401).json({ error: 'Please login' });
}

const storage = multer.diskStorage({
  destination: './public/uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// --- Auth API ---
app.post('/api/register', async (req, res) => {
  const { email, password, studentName, dob } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO users (email, password, student_name, dob) VALUES ($1, $2, $3, $4) RETURNING id",
      [email, password, studentName, dob]
    );
    req.session.userId = result.rows[0].id;
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(400).json({ error: 'Email already exists or DB error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    req.session.userId = result.rows[0].id;
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.get('/api/me', requireLogin, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, email, student_name, dob, level, makeup_credits, avatar_config FROM users WHERE id = $1", [req.session.userId]);
    if(result.rows.length > 0) {
        const user = result.rows[0];
        if(user.avatar_config) user.avatar_config = JSON.parse(user.avatar_config);
        res.json(user);
    } else {
        res.status(404).json({error: 'Not found'});
    }
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- Course & Booking API ---

app.get('/api/courses/recommended', async (req, res) => {
  try {
    // 1. 如果用户已登录，计算真实年龄
    let age = 7; 
    if (req.session.userId) {
        const uRes = await pool.query("SELECT dob FROM users WHERE id = $1", [req.session.userId]);
        if (uRes.rows.length > 0) {
            age = calculateAge(uRes.rows[0].dob);
        }
    }
    
    // 2. 获取所有课程 (未来可以在这里加 WHERE age_group 筛选)
    const result = await pool.query("SELECT * FROM courses");
    res.json({ age: age, courses: result.rows });
  } catch(e) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/my-bookings', requireLogin, async (req, res) => {
  try {
    const result = await pool.query("SELECT course_id, type, dates FROM bookings WHERE user_id = $1", [req.session.userId]);
    const data = result.rows.map(r => ({
        course_id: r.course_id,
        type: r.type,
        dates: r.dates ? JSON.parse(r.dates) : []
    }));
    res.json(data);
  } catch(e) { res.json([]); }
});

app.post('/api/book-course', requireLogin, async (req, res) => {
  const { courseId, type, selectedDates, totalPrice } = req.body;
  const userId = req.session.userId;

  try {
    // 1. 检查整学期重复
    const check = await pool.query("SELECT * FROM bookings WHERE user_id = $1 AND course_id = $2 AND type = 'term'", [userId, courseId]);
    if (check.rows.length > 0) {
        return res.status(400).json({ success: false, message: '您已报名该课程的整学期 (Full Term Already Joined)' });
    }

    // 2. 插入报名
    const datesJson = JSON.stringify(selectedDates || []);
    await pool.query(
        "INSERT INTO bookings (user_id, course_id, type, dates, total_price) VALUES ($1, $2, $3, $4, $5)",
        [userId, courseId, type, datesJson, totalPrice]
    );
    res.json({ success: true, message: 'Booking Confirmed!' });

  } catch(e) {
      console.error(e);
      res.status(500).json({ success: false, message: 'Database Error' });
  }
});

app.get('/api/my-schedule', requireLogin, async (req, res) => {
    try {
        const sql = `
            SELECT b.id as booking_id, b.type as booking_type, b.status, c.name, c.day_of_week, c.start_time, c.teacher, c.classroom 
            FROM bookings b 
            JOIN courses c ON b.course_id = c.id 
            WHERE b.user_id = $1`;
        const result = await pool.query(sql, [req.session.userId]);
        res.json(result.rows);
    } catch(e) { res.json([]); }
});

app.get('/api/my-invoices', requireLogin, async (req, res) => {
    try {
        const sql = `
            SELECT b.id, b.total_price as price_snapshot, b.status, b.created_at, c.name as course_name, c.day_of_week, c.start_time
            FROM bookings b
            JOIN courses c ON b.course_id = c.id
            WHERE b.user_id = $1 ORDER BY b.created_at DESC`;
        const result = await pool.query(sql, [req.session.userId]);
        res.json(result.rows);
    } catch(e) { res.json([]); }
});

// --- Trophy & Other ---
app.post('/api/upload-trophy-v2', requireLogin, upload.fields([{ name: 'mainImage', maxCount: 1 }, { name: 'extraImages', maxCount: 9 }]), async (req, res) => {
    const mainImg = req.files['mainImage'] ? '/uploads/' + req.files['mainImage'][0].filename : null;
    const extras = req.files['extraImages'] ? req.files['extraImages'].map(f => '/uploads/' + f.filename) : [];
    
    if(!mainImg) return res.status(400).json({success:false, error:'Main image missing'});

    try {
        await pool.query(
            "INSERT INTO trophies (user_id, image_path, extra_images, source_name) VALUES ($1, $2, $3, $4)", 
            [req.session.userId, mainImg, JSON.stringify(extras), 'Pending Review']
        );
        res.json({success:true});
    } catch(e) { res.status(500).json({success:false, error: e.message}); }
});

app.get('/api/my-trophies', requireLogin, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM trophies WHERE user_id = $1 ORDER BY created_at DESC", [req.session.userId]);
        res.json(result.rows);
    } catch(e) { res.json([]); }
});

app.post('/api/save-avatar', requireLogin, async (req, res) => {
    try {
        await pool.query("UPDATE users SET avatar_config = $1 WHERE id = $2", [JSON.stringify(req.body.config), req.session.userId]);
        res.json({success:true});
    } catch(e) { res.status(500).json({error: 'Error'}); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));