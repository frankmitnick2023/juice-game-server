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

// === AI 客户端初始化 (带防崩保护) ===
let replicate = null;
try {
    if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN.startsWith('r8_')) {
        replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
        console.log("✅ AI Client Ready");
    } else {
        console.log("⚠️ AI Client Skipped (Mock Mode Active)");
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

// 静态资源增强 (允许跨域)
app.use('/games', express.static(path.join(__dirname, 'games'), { setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*') }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
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
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT)`);
    const uCols = [
        'level INTEGER DEFAULT 1', 'coins INTEGER DEFAULT 0', 'student_name TEXT', 'dob DATE', 
        'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0', 
        "avatar_config JSONB DEFAULT '{}'"
    ];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 2. 业务表
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT DEFAULT 'General')`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price DECIMAL(10, 2) DEFAULT 0`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT DEFAULT 'term', selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'term'`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_dates TEXT`);
    
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, game_id TEXT NOT NULL, score INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ DB Schema Verified');
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

// === API 区域 ===

// 1. AI 头像生成 (含自动降级)
app.post('/api/generate-avatar', upload.single('faceImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let avatarUrl = '';
    let mode = 'Mock';

    try {
        // 尝试调用 AI
        if (replicate) {
            console.log("🚀 Calling Replicate...");
            // 使用更稳定的 face-to-many 模型
            const output = await replicate.run(
              "fofr/face-to-many:a07f252abbbd4328866205a5ef85b737cf775416869d146691534557c51214b6",
              {
                input: {
                  image: fs.createReadStream(req.file.path),
                  style: "video_game",
                  prompt: "cute 3d character, chibi style",
                  negative_prompt: "ugly, distorted"
                }
              }
            );
            avatarUrl = Array.isArray(output) ? output[0] : output;
            mode = 'AI';
        } else {
            throw new Error('No API Key');
        }

    } catch (e) {
        // 降级逻辑：生成随机头像
        console.warn("⚠️ AI Failed, switching to Fallback:", e.message);
        await new Promise(r => setTimeout(r, 1500)); // 模拟等待
        const seed = req.session.user.student_name + Date.now();
        avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4`;
        mode = 'Fallback';
    }

    // 保存配置
    try {
        const config = req.session.user.avatar_config || {};
        config.aiAvatarUrl = avatarUrl;
        config.useAiAvatar = true;
        
        await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]);
        req.session.user.avatar_config = config;

        res.json({ success: true, url: avatarUrl, mode: mode });
    } catch (dbError) {
        res.status(500).json({ error: 'Database Save Failed' });
    }
});

// 2. 游戏列表
function scanGames() {
  const games = [];
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      fs.readdirSync(gamesDir).forEach(dir => {
          const p = path.join(gamesDir, dir, 'game.json');
          if(fs.existsSync(p)) {
              try { games.push({id:dir, ...JSON.parse(fs.readFileSync(p))}); } catch(e){}
          }
      });
  }
  return games;
}
app.get('/api/games', (req, res) => res.json(scanGames()));

// 3. 游戏跳转
app.get('/play/:id', (req, res) => {
  const game = scanGames().find(g => g.id === req.params.id);
  if (!game) return res.status(404).send('Game not found');
  res.redirect(`/wrapper.html?src=${encodeURIComponent('/games/' + game.id + '/index.html')}`);
});

// 4. 荣誉上传
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const imagePath = '/uploads/' + req.file.filename;
    const userName = (req.session.user.student_name || "").toLowerCase();

    try {
        const { data: { text } } = await Tesseract.recognize(req.file.path, 'eng');
        const clean = text.toLowerCase();
        
        // 简单判分
        let type = 'certificate';
        if (clean.includes('gold') || clean.includes('1st')) type = 'gold';
        else if (clean.includes('silver') || clean.includes('2nd')) type = 'silver';
        
        await pool.query(`INSERT INTO user_trophies (user_id, image_path, ocr_text, trophy_type, source_name) VALUES ($1,$2,$3,$4,$5)`, 
            [req.session.user.id, imagePath, text, type, 'Award']);
        
        res.json({ success: true, type });
    } catch(e) {
        res.status(500).json({ error: 'OCR Failed' });
    }
});

app.get('/api/my-trophies', async (req, res) => {
    if (!req.session.user) return res.json([]);
    const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1 ORDER BY created_at DESC', [req.session.user.id]);
    res.json(r.rows);
});

// 其他基础接口
app.post('/api/save-avatar', async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login' }); const { config } = req.body; await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]); req.session.user.avatar_config = config; res.json({ success: true }); });
app.get('/api/me', async (req, res) => { if(!req.session.user) return res.json(null); const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]); req.session.user = r.rows[0]; res.json(r.rows[0]); });
app.post('/api/register', async (req, res) => { const { email, password, studentName, dob } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob) VALUES ($1,$2,$3,$4) RETURNING id, email, student_name`, [email, hash, studentName, dob]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/login', async (req, res) => { const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/courses/recommended', async (req, res) => { try { const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]); const dob = new Date(u.rows[0].dob); let age = new Date().getFullYear() - dob.getFullYear(); if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--; const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]); res.json({ age, courses: list.rows }); } catch (err) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/book-course', async (req, res) => { const { courseId, type, totalPrice } = req.body; try { await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, status) VALUES ($1,$2,$3,$4,$5,'UNPAID')`, [req.session.user.id, courseId, 'Test', totalPrice, type]); res.json({success:true}); } catch(e) { res.status(500).json({error:'Failed'}); } });
app.get('/api/my-schedule', async (req, res) => { try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){ res.status(500).json({error:'Error'}); } });
app.get('/api/my-invoices', async (req, res) => { try { const r = await pool.query(`SELECT b.*, c.name as course_name FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });
app.get('/api/teacher/schedule', async (req, res) => { const r = await pool.query(`SELECT * FROM courses`); res.json(r.rows); });
app.post('/api/teacher/action', async (req, res) => { res.json({success:true}); });
app.get('/api/ai-report', async (req, res) => { res.json({timeStats:[], aiAnalysis:{warnings:[], recommendations:[]}}); });

const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html','avatar_editor.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));