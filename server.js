const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // 必须安装: npm install multer
const Tesseract = require('tesseract.js'); // 必须安装: npm install tesseract.js
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const MemoryStore = session.MemoryStore;
const sessionStore = new MemoryStore();

app.use(session({
  store: sessionStore,
  secret: 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.static('public'));
app.use('/games', express.static('games'));
app.use('/uploads', express.static('uploads')); // 公开上传文件夹

// === 上传配置 ===
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// === 数据库初始化 (包含所有表) ===
(async () => {
  try {
    // 1. 核心表
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0, makeup_credits INTEGER DEFAULT 0)`);
    // 补丁
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0'];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 2. 业务表
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT DEFAULT 'General')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT DEFAULT 'term', selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    
    // 3. 奖杯表 (新)
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ Database Initialized');
    initCourses(); // 初始化课表
  } catch (err) { console.error('DB Init Error:', err); }
})();

// 课表数据初始化
async function initCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return;
    const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:200, c:'RAD' },
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:220, c:'Jazz' },
      { d:'Friday', n:'K-POP (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:180, c:'Kpop' }
    ];
    for (const c of courses) {
      await pool.query(`INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, Math.ceil(c.p/8), c.c]);
    }
  } catch(e){}
}

// === 核心 API ===

// 1. 游戏扫描
function scanGames() {
  const games = {};
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      const dirs = fs.readdirSync(gamesDir);
      dirs.forEach(dir => {
          const jsonPath = path.join(gamesDir, dir, 'game.json');
          if (fs.existsSync(jsonPath)) {
              try {
                  const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                  games[dir] = { id: dir, title: meta.title || dir, description: meta.description || '', thumbnail: meta.thumbnail || '', platform: dir.includes('mobile')?'mobile':'pc', entry: `/games/${dir}/index.html` };
              } catch(e) {}
          }
      });
  }
  return Object.values(games);
}
app.get('/api/games', (req, res) => res.json(scanGames()));

// 2. 用户登录/注册 (防止死锁)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid credentials'});
    req.session.user = r.rows[0];
    res.json(r.rows[0]);
  } catch(e) { console.error(e); res.status(500).json({error:'Server error'}); }
});

app.post('/api/register', async (req, res) => {
  const { email, password, studentName, dob } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob) VALUES ($1,$2,$3,$4) RETURNING id, email`, [email, hash, studentName, dob]);
    req.session.user = r.rows[0]; res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:'Error'}); }
});

app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({success:true})));

// 3. 奖杯上传 (OCR)
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const imagePath = '/uploads/' + req.file.filename;
    
    // 异步处理，防止阻塞
    Tesseract.recognize(req.file.path, 'eng')
        .then(async ({ data: { text } }) => {
            const clean = text.toLowerCase();
            let type = 'bronze';
            let source = 'Certificate';
            
            if (clean.includes('gold') || clean.includes('1st') || clean.includes('distinction')) type = 'gold';
            else if (clean.includes('silver') || clean.includes('2nd') || clean.includes('merit')) type = 'silver';
            
            if (clean.includes('rad')) source = 'RAD Ballet';
            else if (clean.includes('jazz')) source = 'Jazz Award';

            await pool.query(`INSERT INTO user_trophies (user_id, image_path, ocr_text, trophy_type, source_name) VALUES ($1,$2,$3,$4,$5)`, 
                [req.session.user.id, imagePath, text, type, source]);
            
            // 加金币
            const coins = type==='gold'?100:(type==='silver'?50:20);
            await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, req.session.user.id]);
            
            res.json({ success: true, type, source, coins });
        })
        .catch(err => {
            console.error(err);
            res.status(500).json({ error: 'OCR Failed' });
        });
});

app.get('/api/my-trophies', async (req, res) => {
    if (!req.session.user) return res.json([]);
    try {
        const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1', [req.session.user.id]);
        res.json(r.rows);
    } catch(e) { res.json([]); }
});

// 4. 其他业务 API
app.get('/api/courses/recommended', async (req, res) => { /* 同前... */ try { const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]); const dob = new Date(u.rows[0].dob); let age = new Date().getFullYear() - dob.getFullYear(); if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--; const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]); res.json({age, courses: list.rows}); } catch(e){ res.status(500).json({error:'Error'}); } });
app.post('/api/book-course', async (req, res) => { /* 同前... */ const { courseId, type, totalPrice } = req.body; try { const u = await pool.query('SELECT student_name FROM users WHERE id=$1', [req.session.user.id]); await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, status) VALUES ($1,$2,$3,$4,$5,'UNPAID')`, [req.session.user.id, courseId, u.rows[0].student_name, totalPrice, type]); res.json({success:true}); } catch(e) { res.status(500).json({error:'Failed'}); } });
app.get('/api/my-schedule', async (req, res) => { /* 同前... */ try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1`, [req.session.user.id]); res.json(r.rows); } catch(e){} });
app.get('/api/teacher/schedule', async (req, res) => { /* ... */ const r = await pool.query(`SELECT * FROM courses`); res.json(r.rows); });
app.get('/api/ai-report', async (req, res) => { res.json({timeStats:[], aiAnalysis:{warnings:[], recommendations:[]}}); }); // 简化占位

// 路由
const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));
app.get('/play/:id', (req,res)=>res.sendFile(path.join(__dirname,'public','wrapper.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));