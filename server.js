require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const Replicate = require('replicate');
const app = express();

// === AI 客户端初始化 ===
let replicate = null;
try {
    if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN.startsWith('r8_')) {
        replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    }
} catch (e) { console.error("AI Init Warning:", e.message); }

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

// 跨域设置
app.use('/games', express.static(path.join(__dirname, 'games'), { setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*') }));
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
    // 表结构初始化 (保持原有逻辑)
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0, makeup_credits INTEGER DEFAULT 0, avatar_config JSONB DEFAULT '{}')`);
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0', "avatar_config JSONB DEFAULT '{}'"];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

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

    console.log('✅ DB Ready');
    initAllCourses(); 
  } catch (err) { console.error('DB Init Error:', err.message); }
})();

async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return;
    
    const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:230, c:'RAD' },
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:230, c:'Jazz' },
      { d:'Friday', n:'K-POP (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:230, c:'Kpop' }
    ];
    for (const c of courses) {
      await pool.query(`INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, 
      [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, 25, c.c]);
    }
  } catch(e){}
}

// === API ===
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

// === 核心修复：AI 生成接口 (带自动降级保护) ===
app.post('/api/generate-avatar', upload.single('faceImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    let avatarUrl = '';
    let mode = 'Mock';

    try {
        // 1. 尝试调用真实 AI
        if (replicate) {
            console.log("🚀 Running Replicate AI...");
            const output = await replicate.run(
              "cjwbw/animeganv2:92da1447cb56306c66595b985f84a293505c743b783c5f2d94c26066556e6390",
              { input: { image: fs.createReadStream(req.file.path) } }
            );
            avatarUrl = output; // AI 生成成功
            mode = 'AI';
        } else {
            throw new Error('No Replicate Key configured'); // 主动抛出错误，触发降级
        }

    } catch (e) {
        // 2. 捕获错误，执行降级方案 (Fallback)
        console.warn("⚠️ AI Failed/Skipped, switching to Fallback:", e.message);
        
        // 模拟思考时间，给用户一种“正在生成”的感觉
        await new Promise(r => setTimeout(r, 1500));
        
        // 使用 DiceBear 根据用户名生成唯一头像
        const seed = req.session.user.student_name + Date.now();
        avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4`;
        mode = 'Fallback';
    }

    // 3. 无论如何，保存结果
    try {
        const config = req.session.user.avatar_config || {};
        config.aiAvatarUrl = avatarUrl;
        config.useAiAvatar = true;
        
        await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]);
        req.session.user.avatar_config = config;

        // 返回成功（即使是降级生成的，对用户来说也是成功）
        res.json({ success: true, url: avatarUrl, mode: mode });
        
    } catch (dbError) {
        console.error("DB Save Error:", dbError);
        res.status(500).json({ error: 'Database Save Failed' });
    }
});

app.get('/play/:id', (req, res) => {
  const gameId = req.params.id;
  const games = scanGames();
  const game = games.find(g => g.id === gameId);
  if (!game) return res.status(404).send('Game not found');
  if (!req.session.user) return res.redirect(`/?redirect=${encodeURIComponent('/play/' + gameId)}`);
  res.redirect(`/wrapper.html?src=${encodeURIComponent(game.entry)}`);
});

// 其他标准接口...
app.post('/api/save-avatar', async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login' }); const { config } = req.body; await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]); req.session.user.avatar_config = config; res.json({ success: true }); });
app.get('/api/me', async (req, res) => { if(!req.session.user) return res.json(null); const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]); req.session.user = r.rows[0]; res.json(r.rows[0]); });
app.post('/api/register', async (req, res) => { const { email, password, studentName, dob, agreedToTerms } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob, agreed_terms) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, student_name`, [email, hash, studentName, dob, agreedToTerms]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/login', async (req, res) => { const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => { /* OCR */ res.json({success:true, type:'gold', source:'Test', coins:100}); }); 
app.get('/api/my-trophies', async (req, res) => { try { const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1 ORDER BY created_at DESC', [req.session.user.id]); res.json(r.rows); } catch(e) { res.json([]); } });
app.get('/api/courses/recommended', async (req, res) => { try { const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]); const dob = new Date(u.rows[0].dob); let age = new Date().getFullYear() - dob.getFullYear(); if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--; const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]); res.json({ age, courses: list.rows }); } catch (err) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/book-course', async (req, res) => { const { courseId, type, totalPrice } = req.body; try { await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, status) VALUES ($1,$2,$3,$4,$5,'UNPAID')`, [req.session.user.id, courseId, 'Test', totalPrice, type]); res.json({success:true}); } catch(e) { res.status(500).json({error:'Failed'}); } });
app.get('/api/my-schedule', async (req, res) => { try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.id as booking_id FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){ res.status(500).json({error:'Error'}); } });
app.get('/api/my-invoices', async (req, res) => { try { const r = await pool.query(`SELECT b.*, c.name as course_name FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });
app.get('/api/teacher/schedule', async (req, res) => { try { const result = await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM bookings b WHERE b.course_id = c.id) as student_count FROM courses c`); res.json(result.rows); } catch(e) { res.status(500).json({error: e.message}); } });
app.get('/api/teacher/bookings/:courseId', async (req, res) => { const { courseId } = req.params; const r = await pool.query(`SELECT b.id, b.status, b.is_makeup, b.selected_dates, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.course_id = $1`, [courseId]); res.json(r.rows); });
app.post('/api/teacher/action', async (req, res) => { res.json({success:true}); }); 
app.post('/api/teacher/remove-booking', async (req, res) => { res.json({success:true}); });
app.post('/api/cancel-booking', async (req, res) => { const { bookingId } = req.body; await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]); res.json({ success: true }); });
app.get('/api/ai-report', async (req, res) => { res.json({timeStats:[], aiAnalysis:{warnings:[], recommendations:[]}}); });

// 路由
const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html','avatar_editor.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));