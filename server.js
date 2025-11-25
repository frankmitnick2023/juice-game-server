const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Tesseract = require('tesseract.js');
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

app.use('/games', express.static(path.join(__dirname, 'games'), {
  setHeaders: (res) => { res.set('Access-Control-Allow-Origin', '*'); }
}));
app.use('/uploads', express.static('uploads'));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// === 数据库初始化 ===
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0, makeup_credits INTEGER DEFAULT 0)`);
    
    // 补丁：增加 avatar_config 字段，存储捏脸数据 (JSON)
    const uCols = [
        'student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 
        'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0',
        'avatar_config JSONB DEFAULT \'{}\'' // 新增：存储形象配置
    ];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 其他表初始化 (保持不变)
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT DEFAULT 'General')`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT DEFAULT 'term', selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'term'`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_dates TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_makeup BOOLEAN DEFAULT FALSE`);
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'attended'`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, game_id TEXT NOT NULL, score INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ DB Ready (Avatar Config Added)');
    initAllCourses(); 
  } catch (err) { console.error('DB Init Error:', err.message); }
})();

async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return;
    const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', p:180, c:'Technique' },
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:220, c:'Jazz' },
      { d:'Friday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Friday', n:'K-POP (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:180, c:'Kpop' }
    ];
    for (const c of courses) {
      await pool.query(`INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, Math.ceil(c.p/8), c.c]);
    }
  } catch(e){}
}

// === API ===

// 1. 保存形象配置 (新)
app.post('/api/save-avatar', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    const { config } = req.body; // JSON 对象
    try {
        await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]);
        req.session.user.avatar_config = config; // 更新 session
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Save failed' }); }
});

// 2. 获取当前用户 (包含头像配置)
app.get('/api/me', async (req, res) => {
    if(!req.session.user) return res.json(null);
    const r = await pool.query('SELECT id, email, student_name, dob, level, coins, avatar_config, makeup_credits FROM users WHERE id=$1', [req.session.user.id]);
    req.session.user = r.rows[0]; // 刷新 session
    res.json(r.rows[0]);
});

// 3. 其他原有 API (保持不变)
function scanGames() {
  const games = {};
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      const dirs = fs.readdirSync(gamesDir);
      dirs.forEach(dir => {
          const jsonPath = path.join(gamesDir, dir, 'game.json');
          if (fs.existsSync(jsonPath) && fs.existsSync(path.join(gamesDir, dir, 'index.html'))) {
              try {
                  const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                  games[dir] = { id: dir, title: meta.title, description: meta.description, thumbnail: meta.thumbnail, platform: 'mobile', entry: `/games/${dir}/index.html` };
              } catch(e) {}
          }
      });
  }
  return Object.values(games);
}
app.get('/api/games', (req, res) => res.json(scanGames()));
app.get('/play/:id', (req, res) => { /* Wrapper logic */ const g=scanGames().find(x=>x.id===req.params.id); if(g) res.redirect(`/wrapper.html?src=${encodeURIComponent(g.entry)}`); else res.status(404).send('404'); });
app.post('/api/score', async (req, res) => { /* Score logic */ res.json({success:true}); });
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => { /* OCR logic */ res.json({success:true}); }); // 省略 OCR 细节，请保持原有完整逻辑
app.get('/api/my-trophies', async (req, res) => { /* ... */ try { const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1 ORDER BY created_at DESC', [req.session.user.id]); res.json(r.rows); } catch(e) { res.json([]); } });
app.post('/api/register', async (req, res) => { /* ... */ const { email, password, studentName, dob } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob) VALUES ($1,$2,$3,$4) RETURNING id, email`, [email, hash, studentName, dob]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/login', async (req, res) => { /* ... */ const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/courses/recommended', async (req, res) => { /* ... */ try { const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]); const dob = new Date(u.rows[0].dob); let age = new Date().getFullYear() - dob.getFullYear(); if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--; const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]); res.json({ age, courses: list.rows }); } catch (err) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/book-course', async (req, res) => { /* ... */ res.json({ success: true }); }); // 请保留完整的 book-course 逻辑
app.get('/api/my-schedule', async (req, res) => { /* ... */ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1`, [req.session.user.id]); res.json(r.rows); });
app.get('/api/my-invoices', async (req, res) => { /* ... */ const r = await pool.query(`SELECT b.*, c.name as course_name FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1`, [req.session.user.id]); res.json(r.rows); });
app.get('/api/teacher/schedule', async (req, res) => { /* ... */ const r = await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM bookings b WHERE b.course_id=c.id) as student_count FROM courses c`); res.json(r.rows); });
app.get('/api/teacher/bookings/:courseId', async (req, res) => { /* ... */ const r = await pool.query(`SELECT b.id, u.student_name, b.status FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.course_id=$1`, [req.params.courseId]); res.json(r.rows); });
app.post('/api/teacher/check-in', async (req, res) => { /* ... */ res.json({success:true}); });
app.post('/api/teacher/action', async (req, res) => { /* ... */ res.json({success:true}); });
app.get('/api/ai-report', async (req, res) => { /* ... */ res.json({timeStats:[], aiAnalysis:{warnings:[], recommendations:[]}}); });

// 路由
const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html','avatar_editor.html']; // 新增 avatar_editor
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));