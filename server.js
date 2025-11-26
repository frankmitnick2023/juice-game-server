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
    // 1. 建表 (保持不变)
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

    // 2. ★★★ 强制清空旧课程，重新录入完整版课表 ★★★
    await client.query("TRUNCATE TABLE courses RESTART IDENTITY CASCADE");
    console.log("Seeding FULL 2026 Timetable to map Classrooms...");

    // 根据 PDF 整理的完整课程列表 (分配到不同教室以占位)
    const courses = [
      // === MONDAY (Busy: 16:00 有5节课并发) ===
      {name: 'RAD Ballet Grade 5', day: 'Monday', start: '16:00', end: '17:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '9-11'},
      {name: 'Jazz Dance Troupe', day: 'Monday', start: '16:00', end: '17:00', t: 'Katie', p: 230, c: 'Classroom 2', age: '8+'},
      {name: 'Hiphop Level 1', day: 'Monday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Classroom 3', age: '6-8'},
      {name: 'Contemporary Adv', day: 'Monday', start: '16:00', end: '17:00', t: 'Liz', p: 230, c: 'Classroom 4', age: 'Adv'},
      {name: 'Basic Flex & Core', day: 'Monday', start: '16:00', end: '17:00', t: 'Staff', p: 230, c: 'Classroom 5', age: '5'},

      {name: 'Flexibility Core', day: 'Monday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Classroom 1', age: '9-11'},
      {name: 'K-Pop Girl Group', day: 'Monday', start: '17:00', end: '18:00', t: 'Jisoo', p: 230, c: 'Classroom 2', age: '8-10'},
      {name: 'Body Strength', day: 'Monday', start: '17:00', end: '18:00', t: 'Liz', p: 230, c: 'Classroom 3', age: 'Adv'},
      {name: 'Dance Troupe Musical', day: 'Monday', start: '17:00', end: '18:00', t: 'Tarnia', p: 230, c: 'Classroom 4', age: '4-6'},

      {name: 'RAD Ballet Grade 3', day: 'Monday', start: '18:00', end: '19:00', t: 'Liu', p: 230, c: 'Classroom 1', age: '9'},
      {name: 'K-Pop Girl Group', day: 'Monday', start: '18:00', end: '19:30', t: 'Jisoo', p: 240, c: 'Classroom 2', age: '11-16'},
      {name: 'Ballet/Contemp Troupe', day: 'Monday', start: '18:00', end: '19:00', t: 'Tonia/Liz', p: 230, c: 'Classroom 3', age: '11'},
      {name: 'Contemp Troupe', day: 'Monday', start: '18:00', end: '19:30', t: 'Tarnia', p: 240, c: 'Classroom 4', age: '7-9'},
      {name: 'RAD Ballet Grade 5', day: 'Monday', start: '18:00', end: '19:00', t: 'Demi', p: 230, c: 'Classroom 5', age: '9-10'},

      // === TUESDAY ===
      {name: 'Open Ballet Foundation', day: 'Tuesday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: 'Beginner'},
      {name: 'Open Acro', day: 'Tuesday', start: '16:00', end: '17:00', t: 'Cindy', p: 230, c: 'Classroom 2', age: 'Foundation'},
      {name: 'Open Ballet Tech', day: 'Tuesday', start: '16:00', end: '17:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: 'Progression'},

      {name: 'Open Ballet Pilates', day: 'Tuesday', start: '17:00', end: '18:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '10+'},
      {name: 'Open Acro', day: 'Tuesday', start: '17:00', end: '18:00', t: 'Demi', p: 230, c: 'Classroom 2', age: 'Beginner'},
      {name: 'Open Flex/Core', day: 'Tuesday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Classroom 3', age: 'Progression'},
      {name: 'Hiphop Dance Troupe', day: 'Tuesday', start: '17:00', end: '18:30', t: 'Nana', p: 240, c: 'Classroom 4', age: '8+'},

      {name: 'Open Contemp', day: 'Tuesday', start: '18:00', end: '19:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '10+'},
      {name: 'Hiphop Advanced', day: 'Tuesday', start: '18:30', end: '20:00', t: 'Nana', p: 240, c: 'Classroom 4', age: '9-15'},
      
      {name: 'Open Dance Troupe', day: 'Tuesday', start: '19:00', end: '20:00', t: 'Cindy', p: 230, c: 'Classroom 1', age: '12'},
      {name: 'Flex/Core', day: 'Tuesday', start: '19:00', end: '20:00', t: 'Cindy', p: 230, c: 'Classroom 2', age: '10-15'},
      {name: 'Open Ballet Pointe', day: 'Tuesday', start: '19:00', end: '20:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: '10-15'},

      {name: 'RAD Advanced 1', day: 'Tuesday', start: '20:00', end: '21:30', t: 'Tonia', p: 260, c: 'Classroom 1', age: '13-14'},

      // === WEDNESDAY ===
      {name: 'RAD Ballet Grade 4', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '9-10'},
      {name: 'Open Ballet', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Classroom 2', age: 'Beginner'},
      {name: 'Hiphop Level 1', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Classroom 3', age: '6-8'},

      {name: 'Flexibility Core', day: 'Wednesday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Classroom 1', age: '9-13'},
      {name: 'Open Acro', day: 'Wednesday', start: '17:00', end: '18:00', t: 'Demi', p: 230, c: 'Classroom 2', age: 'Beginner'},
      {name: 'Hiphop Level 2', day: 'Wednesday', start: '17:00', end: '18:00', t: 'Nana', p: 230, c: 'Classroom 3', age: '9-15'},

      {name: 'RAD Inter Foundation', day: 'Wednesday', start: '18:00', end: '19:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '10-13'},
      {name: 'Open Contemp', day: 'Wednesday', start: '18:00', end: '19:00', t: 'Asa', p: 230, c: 'Classroom 2', age: '7-9'},

      // === THURSDAY ===
      {name: 'Flexibility Core', day: 'Thursday', start: '16:00', end: '17:00', t: 'Cindy', p: 230, c: 'Classroom 1', age: '7-8'},
      
      {name: 'RAD Ballet Grade 1', day: 'Thursday', start: '17:00', end: '18:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: '7'},
      {name: 'RAD Ballet Grade 2', day: 'Thursday', start: '17:00', end: '18:00', t: 'Demi', p: 230, c: 'Classroom 2', age: '7-8'},
      
      {name: 'RAD Intermediate', day: 'Thursday', start: '17:30', end: '19:00', t: 'Tonia', p: 260, c: 'Classroom 3', age: '10+'}, // Long class

      {name: 'Open Ballet & Pointe', day: 'Thursday', start: '19:00', end: '19:30', t: 'Tonia', p: 150, c: 'Classroom 3', age: 'Adv'},
      {name: 'Open Flex & Acro', day: 'Thursday', start: '19:30', end: '20:30', t: 'Cindy', p: 230, c: 'Classroom 1', age: 'Adv'},
      
      {name: 'RAD Advanced 1', day: 'Thursday', start: '20:00', end: '21:30', t: 'Tonia', p: 260, c: 'Classroom 3', age: '13-15'},

      // === FRIDAY ===
      {name: 'RAD Ballet Grade 1', day: 'Friday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: '7'},
      {name: 'Hiphop Level 1', day: 'Friday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Classroom 2', age: '6-8'},
      {name: 'Contemp Adv', day: 'Friday', start: '16:00', end: '17:00', t: 'Liz', p: 230, c: 'Classroom 3', age: 'Adv'},

      {name: 'Open Ballet Pilates', day: 'Friday', start: '17:00', end: '18:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '7-9'},
      {name: 'Hiphop Level 2', day: 'Friday', start: '17:00', end: '18:00', t: 'Nana', p: 230, c: 'Classroom 2', age: '9-15'},
      {name: 'Body Strength', day: 'Friday', start: '17:00', end: '18:00', t: 'Liz', p: 230, c: 'Classroom 3', age: 'Adv'},

      {name: 'Open Contemp', day: 'Friday', start: '18:00', end: '19:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '7-9'},
      {name: 'Contemp Troupe', day: 'Friday', start: '18:00', end: '19:30', t: 'Tarnia', p: 240, c: 'Classroom 3', age: '7-9'},

      // === SATURDAY (Very Busy) ===
      {name: 'RAD Primary', day: 'Saturday', start: '09:30', end: '11:00', t: 'Carrie', p: 240, c: 'Classroom 1', age: '5'},
      {name: 'RAD Grade 1', day: 'Saturday', start: '09:30', end: '10:30', t: 'Carrie', p: 230, c: 'Classroom 2', age: '7'},
      
      {name: 'Open Acro', day: 'Saturday', start: '10:00', end: '11:00', t: 'Forrest', p: 230, c: 'Classroom 3', age: '9+'},
      
      {name: 'PBT Technique', day: 'Saturday', start: '10:30', end: '11:30', t: 'Carrie', p: 230, c: 'Classroom 2', age: '5-7'},

      {name: 'RAD Beginner', day: 'Saturday', start: '11:00', end: '12:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '3-4.5'},
      {name: 'K-Pop Teens', day: 'Saturday', start: '11:00', end: '12:30', t: 'Hazel', p: 240, c: 'Classroom 4', age: '11-16'}, // Large room
      {name: 'Open Ballet', day: 'Saturday', start: '11:00', end: '12:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: '9+'},

      {name: 'NZAMD Jazz L1', day: 'Saturday', start: '12:00', end: '13:00', t: 'Katie', p: 230, c: 'Classroom 1', age: '5-6'},
      {name: 'RAD Grade 2', day: 'Saturday', start: '12:00', end: '13:00', t: 'Demi', p: 230, c: 'Classroom 2', age: '8'},
      {name: 'Open Pointe', day: 'Saturday', start: '12:00', end: '13:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: '10-16'},

      {name: 'PBT Technique', day: 'Saturday', start: '13:00', end: '14:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: '7-8'},
      {name: 'NZAMD Jazz L3', day: 'Saturday', start: '13:00', end: '14:00', t: 'Katie', p: 230, c: 'Classroom 2', age: '9-10'},
      {name: 'Lyrical Troupe', day: 'Saturday', start: '13:00', end: '14:00', t: 'Cindy', p: 230, c: 'Classroom 3', age: '8+'},
      
      {name: 'RAD Grade 3', day: 'Saturday', start: '13:00', end: '14:00', t: 'Liu', p: 230, c: 'Classroom 4', age: '9'},

      {name: 'RAD Grade 1', day: 'Saturday', start: '14:00', end: '15:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '7'},
      {name: 'PBT Technique', day: 'Saturday', start: '14:00', end: '15:00', t: 'Carrie', p: 230, c: 'Classroom 2', age: '8-9'},
      {name: 'Hiphop Level 1', day: 'Saturday', start: '14:15', end: '15:15', t: 'Gabriel', p: 230, c: 'Classroom 3', age: '6-8'},

      {name: 'RAD Grade 4', day: 'Saturday', start: '15:00', end: '16:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '9-10'},
      {name: 'Breaking L2', day: 'Saturday', start: '15:15', end: '16:15', t: 'Gabriel', p: 230, c: 'Classroom 3', age: '8-11'},
      
      {name: 'NZAMD Jazz L2', day: 'Saturday', start: '15:30', end: '16:30', t: 'Katie', p: 230, c: 'Classroom 2', age: '6.5-8'},
      {name: 'RAD P-Primary', day: 'Saturday', start: '15:30', end: '16:15', t: 'Carrie', p: 230, c: 'Classroom 1', age: '4-5'}
    ];

    for (const c of courses) {
      await client.query(
        "INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [c.name, c.day, c.start, c.end, c.t, c.p, 25, c.c, c.age]
      );
    }
    console.log("Full Timetable loaded successfully!");

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

// --- 公开课表接口 (给教室预约页面用) ---
app.get('/api/public-schedule', async (req, res) => {
    try {
        const result = await pool.query("SELECT name, day_of_week, start_time, end_time, classroom FROM courses");
        res.json(result.rows);
    } catch(e) { res.status(500).json([]); }
});

// --- 选课接口 (带筛选) ---
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
            if (!c.age_group) return true; 
            if (c.age_group === 'Beginner') return true; 
            if (c.age_group === 'Foundation') return true;
            if (c.age_group === 'Progression') return true;
            if (c.age_group === 'Adv') return age >= 10; // 简单逻辑

            if (c.age_group.includes('-')) {
                const parts = c.age_group.split('-');
                const min = parseFloat(parts[0]);
                const max = parseFloat(parts[1]);
                return age >= min && age <= max;
            }
            if (c.age_group.includes('+')) {
                const min = parseFloat(c.age_group);
                return age >= min;
            }
            return age === parseFloat(c.age_group);
        });
    }

    res.json({ age: age, courses: allCourses });
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
    const check = await pool.query("SELECT * FROM bookings WHERE user_id = $1 AND course_id = $2 AND type = 'term'", [userId, courseId]);
    if (check.rows.length > 0) return res.status(400).json({ success: false, message: '已报名该课程整学期' });

    const datesJson = JSON.stringify(selectedDates || []);
    await pool.query(
        "INSERT INTO bookings (user_id, course_id, type, dates, total_price) VALUES ($1, $2, $3, $4, $5)",
        [userId, courseId, type, datesJson, totalPrice]
    );
    res.json({ success: true, message: '报名成功!' });
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