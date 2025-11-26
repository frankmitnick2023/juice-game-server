const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

async function initDB() {
  const client = await pool.connect();
  try {
    // 1. 建表结构 (如果不存在)
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
      type TEXT,
      dates TEXT,
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

    // 2. ★★★ 强制清空旧课程 (保证每次部署都是最新课表) ★★★
    // 注意：这会删除所有旧的课程数据，重新写入下面的真实数据
    await client.query("TRUNCATE TABLE courses RESTART IDENTITY CASCADE");
    console.log("Old courses cleared. Seeding 2026 Term 1 Timetable...");

    // 3. ★★★ 录入 2026 Term 1 真实课表 ★★★
    const courses = [
      // --- MONDAY ---
      {name: 'RAD Ballet Grade 5', day: 'Monday', start: '16:00', end: '17:00', t: 'Demi', p: 230, c: 'Studio 1', age: '9-11'},
      {name: 'Flexibility Core & Acro', day: 'Monday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Studio 2', age: '9-11'},
      {name: 'RAD Ballet Grade 3', day: 'Monday', start: '18:00', end: '19:00', t: 'Liu', p: 230, c: 'Studio 1', age: '9'},
      
      // --- TUESDAY ---
      {name: 'Open Ballet Foundation', day: 'Tuesday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Studio 1', age: 'Beginner'},
      {name: 'Open Acro & Flexibility', day: 'Tuesday', start: '17:00', end: '18:00', t: 'Demi', p: 230, c: 'Studio 2', age: 'Beginner'},
      {name: 'Open Dance Troupe', day: 'Tuesday', start: '19:00', end: '20:00', t: 'Cindy', p: 230, c: 'Studio 1', age: '12+'},
      
      // --- WEDNESDAY ---
      {name: 'RAD Ballet Grade 4', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Demi', p: 230, c: 'Studio 1', age: '9-10'},
      {name: 'Flexibility Core & Acro', day: 'Wednesday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Studio 2', age: '9-13'},
      {name: 'RAD Intermediate Foundation', day: 'Wednesday', start: '18:00', end: '19:00', t: 'Demi', p: 230, c: 'Studio 1', age: '10-13'},
      
      // --- THURSDAY ---
      {name: 'Flexibility Core & Acro', day: 'Thursday', start: '16:00', end: '17:00', t: 'Cindy', p: 230, c: 'Studio 2', age: '7-8'},
      {name: 'RAD Ballet Grade 1', day: 'Thursday', start: '17:00', end: '18:00', t: 'Carrie', p: 230, c: 'Studio 1', age: '7'},
      {name: 'RAD Intermediate', day: 'Thursday', start: '17:30', end: '19:00', t: 'Tonia', p: 260, c: 'Studio 3', age: '10+'}, // 1.5h
      {name: 'Open Ballet & Pointe', day: 'Thursday', start: '19:00', end: '20:00', t: 'Tonia', p: 230, c: 'Studio 1', age: '10-15'},
      {name: 'RAD Advanced 1', day: 'Thursday', start: '20:00', end: '21:30', t: 'Tonia', p: 260, c: 'Studio 1', age: '13-14'},

      // --- FRIDAY ---
      {name: 'RAD Ballet Grade 1', day: 'Friday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Studio 1', age: '7'},
      {name: 'Hiphop Level 1', day: 'Friday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Studio 2', age: '6-8'},
      {name: 'Open Ballet Pilates', day: 'Friday', start: '17:00', end: '18:00', t: 'Asa', p: 230, c: 'Studio 1', age: '7-9'},
      {name: 'Hiphop Level 2', day: 'Friday', start: '17:00', end: '18:00', t: 'Nana', p: 230, c: 'Studio 2', age: '9-15'},
      {name: 'Open Contemp Foundation', day: 'Friday', start: '18:00', end: '19:00', t: 'Asa', p: 230, c: 'Studio 1', age: '7-9'},

      // --- SATURDAY (Busy Day!) ---
      {name: 'RAD Ballet Primary', day: 'Saturday', start: '09:30', end: '11:00', t: 'Carrie', p: 240, c: 'Studio 1', age: '5'},
      {name: 'RAD Beginner Class', day: 'Saturday', start: '11:00', end: '12:00', t: 'Demi', p: 230, c: 'Studio 2', age: '3-4.5'},
      {name: 'K-Pop Girl Group', day: 'Saturday', start: '11:00', end: '12:30', t: 'Hazel', p: 240, c: 'Studio 3', age: '11-16'},
      {name: 'NZAMD Jazz Level 1', day: 'Saturday', start: '12:00', end: '13:00', t: 'Katie', p: 230, c: 'Studio 1', age: '5-6'},
      {name: 'RAD Ballet Grade 2', day: 'Saturday', start: '12:00', end: '13:00', t: 'Demi', p: 230, c: 'Studio 2', age: '8'},
      {name: 'Lyrical Dance Troupe', day: 'Saturday', start: '13:00', end: '14:00', t: 'Cindy', p: 230, c: 'Studio 3', age: '8+'},
      {name: 'PBT Ballet Technique', day: 'Saturday', start: '13:00', end: '14:00', t: 'Carrie', p: 230, c: 'Studio 1', age: '7-8'},
      {name: 'NZAMD Jazz Level 3', day: 'Saturday', start: '13:00', end: '14:00', t: 'Katie', p: 230, c: 'Studio 2', age: '9-10'},
      {name: 'RAD Ballet Grade 1', day: 'Saturday', start: '14:00', end: '15:00', t: 'Demi', p: 230, c: 'Studio 2', age: '7'},
      {name: 'Hiphop Level 1', day: 'Saturday', start: '14:15', end: '15:15', t: 'Gabriel', p: 230, c: 'Studio 3', age: '6-8'},
      {name: 'RAD Ballet Grade 4', day: 'Saturday', start: '15:00', end: '16:00', t: 'Demi', p: 230, c: 'Studio 1', age: '9-10'},
      {name: 'Breaking Level 2', day: 'Saturday', start: '15:15', end: '16:15', t: 'Gabriel', p: 230, c: 'Studio 3', age: '8-11'},
      {name: 'NZAMD Jazz Level 2', day: 'Saturday', start: '15:30', end: '16:30', t: 'Katie', p: 230, c: 'Studio 2', age: '6.5-8'},
      {name: 'RAD P-Primary', day: 'Saturday', start: '15:30', end: '16:15', t: 'Carrie', p: 230, c: 'Studio 1', age: '4-5'}
    ];

    for (const c of courses) {
      await client.query(
        "INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [c.name, c.day, c.start, c.end, c.t, c.p, 25, c.c, c.age]
      );
    }
    console.log("Timetable loaded successfully!");

  } catch (err) { console.error(err); } finally { client.release(); }
}
initDB();

function calculateAge(dob) {
  if (!dob) return 7; 
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
  } catch (err) { res.status(400).json({ error: 'Email exists' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    req.session.userId = result.rows[0].id;
    res.json({ success: true, user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/me', requireLogin, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, email, student_name, dob, level, makeup_credits, avatar_config FROM users WHERE id = $1", [req.session.userId]);
    if(result.rows.length > 0) {
        const user = result.rows[0];
        if(user.avatar_config) user.avatar_config = JSON.parse(user.avatar_config);
        res.json(user);
    } else { res.status(404).json({error: 'Not found'}); }
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// --- ★★★ 课程推荐接口 ★★★ ---
app.get('/api/courses/recommended', async (req, res) => {
  try {
    let age = 7; 
    let filterByAge = false;

    if (req.session.userId) {
        const uRes = await pool.query("SELECT dob FROM users WHERE id = $1", [req.session.userId]);
        if (uRes.rows.length > 0) {
            age = calculateAge(uRes.rows[0].dob);
            filterByAge = true;
        }
    }
    
    const result = await pool.query("SELECT * FROM courses");
    let allCourses = result.rows;

    if (filterByAge) {
        allCourses = allCourses.filter(c => {
            if (!c.age_group) return true; // 无限制
            if (c.age_group === 'Beginner') return true; // 初学者课都显示
            
            // 1. 区间 "9-10"
            if (c.age_group.includes('-')) {
                const parts = c.age_group.split('-');
                const min = parseFloat(parts[0]);
                const max = parseFloat(parts[1]);
                return age >= min && age <= max;
            }
            // 2. 最小年龄 "12+"
            if (c.age_group.includes('+')) {
                const min = parseFloat(c.age_group);
                return age >= min;
            }
            // 3. 单一数字 "5"
            return age === parseFloat(c.age_group);
        });
    }

    res.json({ age: age, courses: allCourses });
  } catch(e) { res.status(500).json({ error: 'DB Error' }); }
});

// --- Booking API ---
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
    const check = await pool.query("SELECT * FROM bookings WHERE user_id = $1 AND course_id = $2 AND type = 'term'", [userId, courseId]);
    if (check.rows.length > 0) return res.status(400).json({ success: false, message: '已报名该课程整学期 (Already Joined)' });

    const datesJson = JSON.stringify(selectedDates || []);
    await pool.query(
        "INSERT INTO bookings (user_id, course_id, type, dates, total_price) VALUES ($1, $2, $3, $4, $5)",
        [userId, courseId, type, datesJson, totalPrice]
    );
    res.json({ success: true, message: '报名成功 (Booking Confirmed)!' });
  } catch(e) { res.status(500).json({ success: false, message: 'Database Error' }); }
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

app.post('/api/upload-trophy-v2', requireLogin, upload.fields([{ name: 'mainImage', maxCount: 1 }, { name: 'extraImages', maxCount: 9 }]), async (req, res) => {
    const mainImg = req.files['mainImage'] ? '/uploads/' + req.files['mainImage'][0].filename : null;
    const extras = req.files['extraImages'] ? req.files['extraImages'].map(f => '/uploads/' + f.filename) : [];
    if(!mainImg) return res.status(400).json({success:false, error:'Main image missing'});
    try {
        await pool.query("INSERT INTO trophies (user_id, image_path, extra_images, source_name) VALUES ($1, $2, $3, $4)", [req.session.userId, mainImg, JSON.stringify(extras), 'Pending Review']);
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