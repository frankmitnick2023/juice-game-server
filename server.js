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

// === 关键修复：静态资源服务 ===
// 必须允许跨域，否则 iframe 加载游戏可能会白屏
app.use('/games', express.static(path.join(__dirname, 'games'), {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
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
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0'];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT DEFAULT 'General')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT DEFAULT 'term', selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ DB Ready');
    initAllCourses(); 
  } catch (err) { console.error('DB Init Error:', err); }
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
      await pool.query(`INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, 
      [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, Math.ceil(c.p/8), c.c]);
    }
  } catch(e){}
}

// === API ===

// 1. 游戏扫描逻辑
function scanGames() {
  const games = {};
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      const dirs = fs.readdirSync(gamesDir);
      dirs.forEach(dir => {
          const jsonPath = path.join(gamesDir, dir, 'game.json');
          // 确保入口文件存在
          if (fs.existsSync(jsonPath) && fs.existsSync(path.join(gamesDir, dir, 'index.html'))) {
              try {
                  const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                  games[dir] = {
                      id: dir,
                      title: meta.title || dir,
                      description: meta.description || '',
                      thumbnail: meta.thumbnail || '',
                      platform: 'mobile',
                      entry: `/games/${dir}/index.html`
                  };
              } catch(e) {}
          }
      });
  }
  return Object.values(games);
}
app.get('/api/games', (req, res) => res.json(scanGames()));

// 2. 奖杯上传 (严格校验版)
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const imagePath = '/uploads/' + req.file.filename;
    
    // 获取用户名字 (拆分匹配，例如 Yolanda Wu -> 匹配 "Yolanda" 或 "Wu")
    const userName = (req.session.user.student_name || "").toLowerCase();
    const nameParts = userName.split(' ').filter(p => p.length > 1); 

    Tesseract.recognize(req.file.path, 'eng')
        .then(async ({ data: { text } }) => {
            const clean = text.toLowerCase();
            console.log(`OCR for ${userName}:`, clean.substring(0, 100));

            // === 核心修复：开启名字校验 ===
            const nameMatch = nameParts.some(part => clean.includes(part));
            
            if (!nameMatch) {
                // 如果没找到名字，拒绝
                return res.json({ success: false, error: `无法在证书上识别到您的名字 "${req.session.user.student_name}"。请确保图片清晰且包含姓名。` });
            }

            let type = 'certificate'; 
            let source = 'Participation';
            let coins = 10; 

            if (clean.includes('gold') || clean.includes('1st') || clean.includes('distinction')) {
                type = 'gold'; coins = 100;
            } else if (clean.includes('silver') || clean.includes('2nd') || clean.includes('merit')) {
                type = 'silver'; coins = 50;
            } else if (clean.includes('bronze') || clean.includes('3rd')) {
                type = 'bronze'; coins = 30;
            }

            if (clean.includes('rad')) source = 'RAD Ballet';
            else if (clean.includes('nzamd')) source = 'NZAMD Jazz';

            await pool.query(`INSERT INTO user_trophies (user_id, image_path, ocr_text, trophy_type, source_name) VALUES ($1,$2,$3,$4,$5)`, 
                [req.session.user.id, imagePath, text, type, source]);
            
            await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, req.session.user.id]);
            
            res.json({ success: true, type, source, coins });
        })
        .catch(err => { res.status(500).json({ error: 'OCR Error' }); });
});

// 3. 其他 API
app.get('/api/my-trophies', async (req, res) => {
    if (!req.session.user) return res.json([]);
    try {
        const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1 ORDER BY created_at DESC', [req.session.user.id]);
        res.json(r.rows);
    } catch(e) { res.json([]); }
});

app.post('/api/login', async (req, res) => { /* ... */ const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid credentials'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/register', async (req, res) => { /* ... */ const { email, password, studentName, dob } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob) VALUES ($1,$2,$3,$4) RETURNING id, email, student_name`, [email, hash, studentName, dob]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

app.get('/api/courses/recommended', async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login' }); try { const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]); const dob = new Date(u.rows[0].dob); let age = new Date().getFullYear() - dob.getFullYear(); if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--; const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]); res.json({ age, courses: list.rows }); } catch (err) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/book-course', async (req, res) => { /* ... */ if(!req.session.user) return res.status(401).json({error:'Login'}); const { courseId, type, selectedDates, totalPrice } = req.body; const userId = req.session.user.id; try { const existing = await pool.query("SELECT booking_type, selected_dates FROM bookings WHERE user_id=$1 AND course_id=$2 AND status != 'cancelled'", [userId, courseId]); const hasTerm = existing.rows.some(r => r.booking_type === 'term'); if (hasTerm) return res.json({ success: false, message: '已报名整学期' }); if (type === 'term' && existing.rows.length > 0) return res.json({ success: false, message: '已有部分报名' }); if (type === 'casual' && selectedDates) { const newDates = new Set(selectedDates); for (const row of existing.rows) { if (row.selected_dates) { const oldDates = row.selected_dates.split(','); for (const d of oldDates) { if (newDates.has(d)) return res.json({ success: false, message: `日期 ${d} 已报名` }); } } } } if (type === 'makeup') { const uRes = await pool.query('SELECT makeup_credits FROM users WHERE id=$1', [userId]); if (uRes.rows[0].makeup_credits <= 0) return res.json({success:false, message:'无补课额度'}); await pool.query('UPDATE users SET makeup_credits = makeup_credits - 1 WHERE id=$1', [userId]); } const u = await pool.query('SELECT student_name FROM users WHERE id=$1', [userId]); const status = type === 'makeup' ? 'PAID' : 'UNPAID'; const isMakeup = type === 'makeup'; const price = type === 'makeup' ? 0 : totalPrice; await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status, is_makeup) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [userId, courseId, u.rows[0].student_name, price, type, selectedDates?selectedDates.join(','):'', status, isMakeup]); res.json({ success: true, message: '报名成功' }); } catch(e) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/my-schedule', async (req, res) => { /* ... */ if(!req.session.user) return res.status(401).json({error:'Login'}); try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.booking_type, b.selected_dates FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });
app.get('/api/my-invoices', async (req, res) => { try { const r = await pool.query(`SELECT b.*, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });
app.get('/api/teacher/schedule', async (req, res) => { try { const result = await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM bookings b WHERE b.course_id = c.id) as student_count FROM courses c ORDER BY start_time`); res.json(result.rows); } catch(e) { res.status(500).json({error: e.message}); } });
app.get('/api/teacher/bookings/:courseId', async (req, res) => { const { courseId } = req.params; const r = await pool.query(`SELECT b.id, b.status, b.is_makeup, b.selected_dates, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.course_id = $1`, [courseId]); res.json(r.rows); });
app.post('/api/teacher/action', async (req, res) => { /* ... */ const {bookingId, courseId, action} = req.body; try { const c = (await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id=$1', [courseId])).rows[0]; const bRes = await pool.query('SELECT user_id FROM bookings WHERE id=$1', [bookingId]); const userId = bRes.rows[0].user_id; if (action === 'present') { const [sH, sM] = c.start_time.split(':').map(Number); const [eH, eM] = c.end_time.split(':').map(Number); const duration = (eH*60 + eM) - (sH*60 + sM); await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,$5,'attended', NOW())`, [userId, courseId, c.name, c.category, duration]); await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]); await pool.query("UPDATE bookings SET status = 'attended' WHERE id = $1", [bookingId]); res.json({ success: true, msg: `签到+${duration}` }); } else if (action === 'absent') { await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,0,'absent', NOW())`, [userId, courseId, c.name, c.category]); await pool.query(`UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id = $1`, [userId]); res.json({ success: true, msg: '缺勤,补课+1' }); } } catch(e) { res.status(500).json({ error: 'Error' }); } });
app.get('/api/ai-report', async (req, res) => { /* ... */ try { const stats = await pool.query(`SELECT category, SUM(duration_minutes) as total FROM attendance_logs WHERE user_id=$1 GROUP BY category`, [req.session.user.id]); res.json({timeStats: stats.rows, aiAnalysis: {warnings:[], recommendations:[]}}); } catch(e) { res.status(500).json({error:'Error'}); } });

app.get('/play/:id', (req, res) => {
    const gameId = req.params.id;
    const games = scanGames();
    const game = games.find(g => g.id === gameId);
    if(game) {
        // 关键修复：返回带 src 参数的 wrapper.html
        res.redirect(`/wrapper.html?src=${encodeURIComponent(game.entry)}`);
    } else {
        res.status(404).send('Game not found');
    }
});

// 路由
const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));