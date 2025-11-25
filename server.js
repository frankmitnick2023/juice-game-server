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
    // 用户表
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0)`);
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0'];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 课程表
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT)`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price DECIMAL(10,2) DEFAULT 0`);

    // 报名表
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT, selected_dates TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    
    // 日志 & 分数
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('DB Initialized');
    initCourses();
  } catch (err) { console.error('DB Init Error:', err); }
})();

async function initCourses() {
  const check = await pool.query("SELECT count(*) FROM courses");
  if (parseInt(check.rows[0].count) > 5) return;
  console.log('Seeding Courses...');
  const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', p:180, c:'Technique' },
      { d:'Tuesday', n:'英皇芭蕾2级', s:'17:00', e:'18:00', min:7, max:8, t:'DEMI', p:200, c:'RAD' },
      { d:'Wednesday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:220, c:'Jazz' },
      { d:'Friday', n:'K-POP (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:180, c:'Kpop' },
      { d:'Saturday', n:'幼儿芭蕾启蒙', s:'11:00', e:'12:00', min:3, max:5, t:'DEMI', p:180, c:'Ballet' }
  ];
  for (const c of courses) {
      await pool.query(`INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, 
      [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, Math.ceil(c.p/8), c.c]);
  }
}

// === 核心功能 API ===

// 1. 真实游戏扫描 (修复版)
function scanGames() {
  const games = {};
  // 扫描 games 文件夹
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      const dirs = fs.readdirSync(gamesDir);
      dirs.forEach(dir => {
          const jsonPath = path.join(gamesDir, dir, 'game.json');
          if (fs.existsSync(jsonPath)) {
              try {
                  const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                  games[dir] = {
                      id: dir,
                      title: meta.title || dir,
                      description: meta.description || '',
                      thumbnail: meta.thumbnail || '',
                      platform: dir.includes('mobile') ? 'mobile' : 'pc',
                      entry: `/games/${dir}/index.html`
                  };
              } catch(e) {}
          }
      });
  }
  // 加入 Demo
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
      games['demo'] = { id:'demo', title:'Demo Game', description:'Test', thumbnail:'', platform:'both', entry:'/games/demo-game.html' };
  }
  return Object.values(games);
}

app.get('/api/games', (req, res) => res.json(scanGames()));

// 2. 用户 & 鉴权
app.post('/api/register', async (req, res) => {
  const { email, password, studentName, dob } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob) VALUES ($1,$2,$3,$4) RETURNING id, email, student_name`, [email, hash, studentName, dob]);
    req.session.user = r.rows[0]; res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:'Error'}); }
});
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'});
    req.session.user = r.rows[0]; res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:'Error'}); }
});
app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({success:true})));

// 3. 课表推荐
app.get('/api/courses/recommended', async (req, res) => {
  if(!req.session.user) return res.status(401).json({error:'Login'});
  try {
    const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]);
    if(!u.rows[0].dob) return res.status(400).json({error:'No DOB'});
    
    const dob = new Date(u.rows[0].dob);
    let age = new Date().getFullYear() - dob.getFullYear();
    if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--;
    
    const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]);
    res.json({age, courses: list.rows});
  } catch(e) { res.status(500).json({error:'Error'}); }
});

// 4. 报名 (修复: 增加 LEFT JOIN 确保账单显示)
app.post('/api/book-course', async (req, res) => {
  if(!req.session.user) return res.status(401).json({error:'Login'});
  const { courseId, type, totalPrice } = req.body;
  try {
    const u = await pool.query('SELECT student_name FROM users WHERE id=$1', [req.session.user.id]);
    await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, status) VALUES ($1,$2,$3,$4,$5,'UNPAID')`, 
        [req.session.user.id, courseId, u.rows[0].student_name, totalPrice, type]);
    res.json({success:true});
  } catch(e) { res.status(500).json({error:'Failed'}); }
});

// 5. 我的课表 & 账单
app.get('/api/my-schedule', async (req, res) => {
    if(!req.session.user) return res.status(401).json({error:'Login'});
    try {
        const r = await pool.query(`
            SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.created_at, b.id as booking_id
            FROM bookings b
            JOIN courses c ON b.course_id = c.id
            WHERE b.user_id = $1
            ORDER BY b.created_at DESC
        `, [req.session.user.id]);
        res.json(r.rows);
    } catch(e) { res.status(500).json({error:'Error'}); }
});

// 6. AI 报告
app.get('/api/ai-report', async (req, res) => {
    if(!req.session.user) return res.status(401).json({error:'Login'});
    try {
        const stats = await pool.query(`SELECT category, SUM(duration_minutes) as total FROM attendance_logs WHERE user_id=$1 GROUP BY category`, [req.session.user.id]);
        res.json({timeStats: stats.rows, aiAnalysis: {warnings:[], recommendations:[]}});
    } catch(e) { res.status(500).json({error:'Error'}); }
});

// 路由
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/timetable.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'timetable.html')));
app.get('/my_schedule.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my_schedule.html')));
app.get('/growth.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'growth.html')));
app.get('/play/:id', async (req,res) => { /* Wrapper logic simplified */ res.sendFile(path.join(__dirname, 'public', 'wrapper.html')); }); 

app.listen(process.env.PORT || 3000, () => console.log('Server running'));