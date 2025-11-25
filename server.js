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
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.static('public'));

// 允许跨域加载游戏资源
app.use('/games', express.static(path.join(__dirname, 'games'), {
  setHeaders: (res) => { res.set('Access-Control-Allow-Origin', '*'); }
}));
app.use('/uploads', express.static('uploads'));
app.use('/avatars', express.static(path.join(__dirname, 'public', 'avatars')));

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
    // 1. 用户表
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0, makeup_credits INTEGER DEFAULT 0, avatar_config JSONB DEFAULT '{}')`);
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0', "avatar_config JSONB DEFAULT '{}'"];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 2. 课程表
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT DEFAULT 'General')`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price DECIMAL(10, 2) DEFAULT 0`);

    // 3. 报名表
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT DEFAULT 'term', selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    // 补丁
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'term'`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_dates TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_makeup BOOLEAN DEFAULT FALSE`);
    
    // 4. 日志表
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'attended'`);

    // 5. 其他表
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, game_id TEXT NOT NULL, score INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ DB Ready');
    
    // 执行全量课表初始化
    initAllCourses(); 

  } catch (err) { console.error('DB Init Error:', err.message); }
})();

async function initAllCourses() {
  try {
    // === 强制重置逻辑 ===
    // 为了确保您看到完整的课表，我们会先检查课程数量。
    // 如果少于 10 节（说明是旧数据），则清空重录。
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 10) {
        console.log('课表数据已完整，跳过初始化');
        return; 
    }

    console.log('正在重置并录入 2026 全量课表...');
    
    // 清空旧课程 (注意：这会级联删除关联的 bookings，方便您重新测试)
    await pool.query("TRUNCATE courses CASCADE");

    // 价格配置
    const P_TERM = 230;
    const P_CASUAL = 25;

    const courses = [
      // === MONDAY (周一) ===
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心与技巧 (Foundation)', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', c:'Technique' },
      { d:'Monday', n:'OPEN 芭蕾技巧与基础 (Beginner)', s:'16:00', e:'17:00', min:5, max:8, t:'CARRIE', c:'Ballet' },
      { d:'Monday', n:'软开度/旋转/核心', s:'17:00', e:'18:00', min:9, max:11, t:'CINDY', c:'Technique' },
      { d:'Monday', n:'英皇芭蕾3级', s:'18:00', e:'19:00', min:9, max:99, t:'LIU', c:'RAD' },
      { d:'Monday', n:'OPEN 舞团班', s:'19:00', e:'20:00', min:12, max:99, t:'CINDY', c:'Performance' },

      // === TUESDAY (周二) ===
      { d:'Tuesday', n:'英皇芭蕾4级', s:'16:00', e:'17:00', min:9, max:10, t:'DEMI', c:'RAD' },
      { d:'Tuesday', n:'软开度/核心与技巧', s:'16:00', e:'17:00', min:7, max:8, t:'CINDY', c:'Technique' },
      { d:'Tuesday', n:'英皇芭蕾1级', s:'17:00', e:'18:00', min:7, max:99, t:'CARRIE', c:'RAD' },
      { d:'Tuesday', n:'英皇芭蕾2级', s:'17:00', e:'18:00', min:7, max:8, t:'DEMI', c:'RAD' },
      { d:'Tuesday', n:'RAD INTERMEDIATE FOUNDATION', s:'17:30', e:'19:00', min:10, max:99, t:'TONIA', c:'RAD' },
      { d:'Tuesday', n:'OPEN 芭蕾足尖课', s:'19:00', e:'20:00', min:10, max:15, t:'TONIA', c:'Ballet' },

      // === WEDNESDAY (周三) ===
      { d:'Wednesday', n:'英皇芭蕾1级', s:'16:00', e:'17:00', min:7, max:99, t:'CARRIE', c:'RAD' },
      { d:'Wednesday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', c:'HipHop' },
      { d:'Wednesday', n:'芭蕾普拉提', s:'17:00', e:'18:00', min:7, max:9, t:'ASA', c:'Ballet' },
      { d:'Wednesday', n:'HIPHOP LEVEL 2', s:'17:00', e:'18:00', min:9, max:15, t:'NANA', c:'HipHop' },
      { d:'Wednesday', n:'RAD BALLET INTERMEDIATE', s:'17:30', e:'19:00', min:10, max:99, t:'TONIA', c:'RAD' },
      { d:'Wednesday', n:'OPEN 现代舞基础', s:'18:00', e:'19:00', min:7, max:9, t:'ASA', c:'Contemporary' },
      { d:'Wednesday', n:'OPEN 芭蕾足尖', s:'19:00', e:'19:30', min:12, max:99, t:'TONIA', c:'Ballet' },

      // === THURSDAY (周四) ===
      { d:'Thursday', n:'基础软开与核心训练', s:'16:00', e:'17:00', min:5, max:6, t:'DEMI', c:'Technique' },
      { d:'Thursday', n:'OPEN 芭蕾技巧 (Progression)', s:'16:00', e:'17:00', min:7, max:99, t:'TONIA', c:'Ballet' },
      { d:'Thursday', n:'DANCE TROUPE MUSICAL', s:'17:00', e:'18:00', min:4, max:6, t:'TARNIA', c:'Performance' },
      { d:'Thursday', n:'英皇芭蕾5级', s:'18:00', e:'19:00', min:9, max:10, t:'DEMI', c:'RAD' },
      { d:'Thursday', n:'HIPHOP 提高班', s:'18:30', e:'20:00', min:9, max:15, t:'NANA', c:'HipHop' },

      // === FRIDAY (周五) ===
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', c:'Jazz' },
      { d:'Friday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', c:'HipHop' },
      { d:'Friday', n:'K-POP 韩国流行舞 (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', c:'Kpop' },
      { d:'Friday', n:'身体力量与体能训练', s:'17:00', e:'18:00', min:9, max:99, t:'LIZ', c:'Technique' },
      { d:'Friday', n:'K-POP 韩国流行舞 (青少)', s:'18:00', e:'19:30', min:11, max:16, t:'JISOO', c:'Kpop' },
      { d:'Friday', n:'芭蕾&现代舞舞团', s:'18:00', e:'19:00', min:11, max:99, t:'TONIA', c:'Performance' },

      // === SATURDAY (周六) ===
      { d:'Saturday', n:'英皇芭蕾 PRIMARY', s:'09:30', e:'11:00', min:5, max:6, t:'CARRIE', c:'RAD' },
      { d:'Saturday', n:'幼儿芭蕾启蒙班', s:'11:00', e:'12:00', min:3, max:5, t:'DEMI', c:'Ballet' },
      { d:'Saturday', n:'K-POP', s:'11:00', e:'12:30', min:11, max:16, t:'HAZEL', c:'Kpop' },
      { d:'Saturday', n:'NZAMD 爵士考级 L1', s:'12:00', e:'13:00', min:5, max:6, t:'KATIE', c:'Jazz' },
      { d:'Saturday', n:'英皇芭蕾2级', s:'12:00', e:'13:00', min:8, max:9, t:'DEMI', c:'RAD' },
      { d:'Saturday', n:'PBT 进阶芭蕾技巧', s:'13:00', e:'14:00', min:7, max:8, t:'CARRIE', c:'Technique' },
      { d:'Saturday', n:'NZAMD 爵士考级 L3', s:'13:00', e:'14:00', min:9, max:10, t:'KATIE', c:'Jazz' },

      // === SUNDAY (周日) ===
      { d:'Sunday', n:'英皇芭蕾 GRADE 1', s:'09:30', e:'10:30', min:7, max:99, t:'CARRIE', c:'RAD' },
      { d:'Sunday', n:'PBT 芭蕾技巧', s:'10:30', e:'11:30', min:5, max:7, t:'CARRIE', c:'Technique' },
      { d:'Sunday', n:'英皇芭蕾 PRIMARY', s:'11:30', e:'13:00', min:5, max:6, t:'CARRIE', c:'RAD' },
      { d:'Sunday', n:'OPEN 软开核心', s:'10:00', e:'11:00', min:9, max:99, t:'FORREST', c:'Technique' },
      { d:'Sunday', n:'OPEN 芭蕾技巧与基础', s:'11:00', e:'12:00', min:9, max:99, t:'TONIA', c:'Ballet' },
      { d:'Sunday', n:'OPEN 芭蕾足尖课', s:'12:00', e:'13:00', min:10, max:16, t:'TONIA', c:'Ballet' }
    ];

    for (const c of courses) {
      await pool.query(
        `INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [c.n, c.d, c.s, c.e, c.min, c.max, c.t, P_TERM, P_CASUAL, c.c]
      );
    }
    console.log('✅ 2026 全量课表重置完成');
  } catch(e){ console.error(e); }
}

// === API (保持不变) ===
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
app.post('/api/upload-face', upload.single('faceImage'), async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login required' }); if (!req.file) return res.status(400).json({ error: 'No file' }); const faceUrl = '/uploads/' + req.file.filename; res.json({ success: true, url: faceUrl }); });
app.get('/play/:id', (req, res) => { const gameId = req.params.id; const games = scanGames(); const game = games.find(g => g.id === gameId); if (!game) return res.status(404).send('Game not found'); if (!req.session.user) return res.redirect(`/?redirect=${encodeURIComponent('/play/' + gameId)}`); res.redirect(`/wrapper.html?src=${encodeURIComponent(game.entry)}`); });
app.post('/api/save-avatar', async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login required' }); const { config } = req.body; try { await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]); req.session.user.avatar_config = config; res.json({ success: true }); } catch(e) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/me', async (req, res) => { if(!req.session.user) return res.json(null); const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]); req.session.user = r.rows[0]; res.json(r.rows[0]); });
app.post('/api/register', async (req, res) => { const { email, password, studentName, dob, agreedToTerms } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob, agreed_terms) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, student_name`, [email, hash, studentName, dob, agreedToTerms]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/login', async (req, res) => { const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => { /* OCR逻辑 */ res.json({success:true, type:'gold', source:'Test', coins:100}); }); 
app.get('/api/my-trophies', async (req, res) => { try { const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1 ORDER BY created_at DESC', [req.session.user.id]); res.json(r.rows); } catch(e) { res.json([]); } });
app.get('/api/courses/recommended', async (req, res) => { try { const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]); const dob = new Date(u.rows[0].dob); let age = new Date().getFullYear() - dob.getFullYear(); if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--; const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]); res.json({ age, courses: list.rows }); } catch (err) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/book-course', async (req, res) => { /* Book Logic */ const { courseId, type, selectedDates, totalPrice } = req.body; const userId = req.session.user.id; try { const existing = await pool.query("SELECT booking_type, selected_dates FROM bookings WHERE user_id=$1 AND course_id=$2 AND status != 'cancelled'", [userId, courseId]); if (existing.rows.some(r => r.booking_type === 'term')) return res.json({ success: false, message: 'Already booked Full Term' }); if (type === 'term' && existing.rows.length > 0) return res.json({ success: false, message: 'Partially booked' }); if (type === 'casual' && selectedDates) { const newDates = new Set(selectedDates); for (const row of existing.rows) { if (row.selected_dates) { const oldDates = row.selected_dates.split(','); for (const d of oldDates) { if (newDates.has(d)) return res.json({ success: false, message: `Date ${d} already booked` }); } } } } if (type === 'makeup') { const uRes = await pool.query('SELECT makeup_credits FROM users WHERE id=$1', [userId]); if (uRes.rows[0].makeup_credits <= 0) return res.json({success:false, message:'No makeup credits'}); await pool.query('UPDATE users SET makeup_credits = makeup_credits - 1 WHERE id=$1', [userId]); } const u = await pool.query('SELECT student_name FROM users WHERE id=$1', [userId]); const status = type === 'makeup' ? 'PAID' : 'UNPAID'; const isMakeup = type === 'makeup'; const price = type === 'makeup' ? 0 : totalPrice; await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status, is_makeup) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [userId, courseId, u.rows[0].student_name, price, type, selectedDates?selectedDates.join(','):'', status, isMakeup]); res.json({ success: true, message: 'Booking Success!' }); } catch(e) { res.status(500).json({ error: 'Failed' }); } });
app.get('/api/my-schedule', async (req, res) => { try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.id as booking_id, b.is_makeup FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){ res.status(500).json({error:'Error'}); } });
app.get('/api/my-invoices', async (req, res) => { try { const r = await pool.query(`SELECT b.*, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });
app.get('/api/teacher/schedule', async (req, res) => { try { const result = await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM bookings b WHERE b.course_id = c.id) as student_count FROM courses c ORDER BY CASE WHEN day_of_week='Monday' THEN 1 WHEN day_of_week='Tuesday' THEN 2 WHEN day_of_week='Wednesday' THEN 3 WHEN day_of_week='Thursday' THEN 4 WHEN day_of_week='Friday' THEN 5 WHEN day_of_week='Saturday' THEN 6 ELSE 7 END, start_time`); res.json(result.rows); } catch(e) { res.status(500).json({error: e.message}); } });
app.get('/api/teacher/bookings/:courseId', async (req, res) => { const { courseId } = req.params; const r = await pool.query(`SELECT b.id, b.status, b.is_makeup, b.selected_dates, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.course_id = $1`, [courseId]); res.json(r.rows); });
app.post('/api/teacher/action', async (req, res) => { const {bookingId, courseId, action} = req.body; try { const c = (await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id=$1', [courseId])).rows[0]; const bRes = await pool.query('SELECT user_id FROM bookings WHERE id=$1', [bookingId]); const userId = bRes.rows[0].user_id; if (action === 'present') { const [sH, sM] = c.start_time.split(':').map(Number); const [eH, eM] = c.end_time.split(':').map(Number); const duration = (eH*60 + eM) - (sH*60 + sM); await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,$5,'attended', NOW())`, [userId, courseId, c.name, c.category, duration]); await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]); await pool.query("UPDATE bookings SET status = 'attended' WHERE id = $1", [bookingId]); res.json({ success: true, msg: `签到+${duration}` }); } else if (action === 'absent') { await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,0,'absent', NOW())`, [userId, courseId, c.name, c.category]); await pool.query(`UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id = $1`, [userId]); res.json({ success: true, msg: '补课+1' }); } } catch(e) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/teacher/remove-booking', async (req, res) => { const { bookingId } = req.body; try { const check = await pool.query('SELECT user_id, is_makeup FROM bookings WHERE id=$1', [bookingId]); if (check.rows.length > 0 && check.rows[0].is_makeup) { await pool.query('UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id=$1', [check.rows[0].user_id]); } await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]); res.json({ success: true }); } catch(e) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/cancel-booking', async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login' }); const { bookingId } = req.body; try { const check = await pool.query('SELECT status FROM bookings WHERE id=$1 AND user_id=$2', [bookingId, req.session.user.id]); if (check.rows.length === 0) return res.json({ success: false, message: 'Order not found' }); if (check.rows[0].status !== 'UNPAID') return res.json({ success: false, message: 'Cannot cancel paid order' }); await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]); res.json({ success: true }); } catch(e) { res.status(500).json({ error: 'Error' }); } });
app.get('/api/ai-report', async (req, res) => { if(!req.session.user) return res.status(401).json({error:'Login'}); try { const stats = await pool.query(`SELECT category, SUM(duration_minutes) as total FROM attendance_logs WHERE user_id=$1 GROUP BY category`, [req.session.user.id]); res.json({timeStats: stats.rows, aiAnalysis: {warnings:[], recommendations:[]}}); } catch(e) { res.status(500).json({error:'Error'}); } });

const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html','avatar_editor.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));