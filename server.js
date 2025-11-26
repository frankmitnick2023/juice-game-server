const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const multer = require('multer');

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

// --- 1. 数据库初始化 (只建表，不录数据) ---
async function initDB() {
  const client = await pool.connect();
  try {
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

    // 课程表
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
    
    console.log("DB initialized. Ready for Admin input.");

  } catch (err) { console.error(err); } finally { client.release(); }
}
initDB();

// --- 辅助函数 ---
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

// --- Auth ---
app.post('/api/register', async (req, res) => {
  const { email, password, studentName, dob } = req.body;
  try {
    const result = await pool.query("INSERT INTO users (email, password, student_name, dob) VALUES ($1, $2, $3, $4) RETURNING id", [email, password, studentName, dob]);
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

// --- ★★★ Admin Course Management APIs (新加的) ★★★ ---

// 1. 添加课程
app.post('/api/admin/courses', async (req, res) => {
    const { name, day, start, end, teacher, price, classroom, age } = req.body;
    try {
        await pool.query(
            "INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1, $2, $3, $4, $5, $6, 25, $7, $8)",
            [name, day, start, end, teacher, price, classroom, age]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. 删除课程
app.delete('/api/admin/courses/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM courses WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. 获取所有课程 (无筛选，给后台用)
app.get('/api/admin/all-courses', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM courses ORDER BY day_of_week, start_time");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// --- Public & User APIs ---

app.get('/api/public-schedule', async (req, res) => {
    try {
        const result = await pool.query("SELECT name, day_of_week, start_time, end_time, classroom FROM courses");
        res.json(result.rows);
    } catch(e) { res.status(500).json([]); }
});

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
            if (c.age_group.toLowerCase().includes('beginner')) return true;
            
            // 简单区间判断
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
            // 单数字
            if (!isNaN(parseFloat(c.age_group))) {
                 return age === parseFloat(c.age_group);
            }
            return true;
        });
    }
    res.json({ age: age, courses: allCourses });
  } catch(e) { res.status(500).json({ error: 'DB Error' }); }
});

// ... (保留 Booking, Schedule, Trophy, Avatar 接口不变) ...
// 为节省篇幅，这部分逻辑和之前一样，没有变动。
// 如果你需要完整文件，我可以再发一次，但核心就是上面增加了 Admin API。

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));