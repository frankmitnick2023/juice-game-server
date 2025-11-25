require('dotenv').config(); // 读取 .env 配置
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

// === 1. AI 客户端初始化 (带容错) ===
let replicate = null;
try {
    // 只有当环境变量存在且看起来有效时才初始化
    if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN.startsWith('r8_')) {
        replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
        console.log("✅ AI Client Ready");
    } else {
        console.log("⚠️ AI Client Skipped (Mock Mode Active - Add REPLICATE_API_TOKEN to use real AI)");
    }
} catch (e) { console.error("AI Init Warning:", e.message); }

// === 2. 数据库连接 ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === 3. 中间件配置 ===
const MemoryStore = session.MemoryStore;
const sessionStore = new MemoryStore();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7天
}));

app.use(express.json());
app.use(express.static('public')); // 托管前端页面

// 静态资源增强配置 (允许跨域，确保图片和游戏加载正常)
app.use('/games', express.static(path.join(__dirname, 'games'), { setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*') }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/avatars', express.static(path.join(__dirname, 'public', 'avatars')));

// 文件上传配置
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// === 4. 数据库初始化 (全量表结构) ===
(async () => {
  try {
    console.log('🔄 Checking Database Schema...');

    // 用户表
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT)`);
    const uCols = [
        'level INTEGER DEFAULT 1', 'coins INTEGER DEFAULT 0', 'student_name TEXT', 'dob DATE', 
        'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0', 
        "avatar_config JSONB DEFAULT '{}'"
    ];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 课程表
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT)`);
    const cCols = [
        'day_of_week TEXT', 'start_time TEXT', 'end_time TEXT', 'min_age INTEGER DEFAULT 0', 'max_age INTEGER DEFAULT 99',
        'teacher TEXT', 'price DECIMAL(10,2) DEFAULT 0', 'casual_price DECIMAL(10,2) DEFAULT 0', "category TEXT DEFAULT 'General'"
    ];
    for(const c of cCols) await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS ${c}`);

    // 报名表
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER)`);
    const bCols = [
        'student_name TEXT', "status TEXT DEFAULT 'UNPAID'", 'price_snapshot DECIMAL(10,2) DEFAULT 0',
        "booking_type TEXT DEFAULT 'term'", 'selected_dates TEXT', 'is_makeup BOOLEAN DEFAULT FALSE', 'created_at TIMESTAMP DEFAULT NOW()'
    ];
    for(const c of bCols) await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ${c}`);

    // 日志表
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER)`);
    const lCols = ['course_name TEXT', 'category TEXT', 'duration_minutes INTEGER', "status TEXT DEFAULT 'attended'", 'check_in_time TIMESTAMP DEFAULT NOW()'];
    for(const c of lCols) await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS ${c}`);

    // 分数表 & 奖杯表
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ DB Schema Verified');
    initAllCourses(); 
  } catch (err) { console.error('DB Init Error:', err.message); }
})();

// === 5. 课表数据录入 ===
async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    // 只有当课程为空或很少时才重置，避免覆盖手动修改的数据
    if (parseInt(check.rows[0].count) > 10) return;

    console.log('Seeding 2026 Courses...');
    await pool.query("TRUNCATE courses CASCADE"); // 清理旧数据

    // 价格策略
    const P_TERM = 230; 
    const P_CASUAL = 25;

    const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', c:'Technique' },
      { d:'Monday', n:'OPEN 芭蕾技巧', s:'16:00', e:'17:00', min:5, max:8, t:'CARRIE', c:'Ballet' },
      { d:'Monday', n:'英皇芭蕾3级', s:'18:00', e:'19:00', min:9, max:99, t:'LIU', c:'RAD' },
      { d:'Monday', n:'OPEN 舞团班', s:'19:00', e:'20:00', min:12, max:99, t:'CINDY', c:'Performance' },
      { d:'Tuesday', n:'英皇芭蕾4级', s:'16:00', e:'17:00', min:9, max:10, t:'DEMI', c:'RAD' },
      { d:'Tuesday', n:'软开度/核心', s:'16:00', e:'17:00', min:7, max:8, t:'CINDY', c:'Technique' },
      { d:'Tuesday', n:'英皇芭蕾2级', s:'17:00', e:'18:00', min:7, max:8, t:'DEMI', c:'RAD' },
      { d:'Tuesday', n:'RAD IF', s:'18:00', e:'19:00', min:10, max:13, t:'DEMI', c:'RAD' },
      { d:'Tuesday', n:'OPEN 足尖课', s:'19:00', e:'20:00', min:10, max:15, t:'TONIA', c:'Ballet' },
      { d:'Wednesday', n:'英皇芭蕾1级', s:'16:00', e:'17:00', min:7, max:99, t:'CARRIE', c:'RAD' },
      { d:'Wednesday', n:'HIPHOP L1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', c:'HipHop' },
      { d:'Wednesday', n:'HIPHOP L2', s:'17:00', e:'18:00', min:9, max:15, t:'NANA', c:'HipHop' },
      { d:'Wednesday', n:'现代舞基础', s:'18:00', e:'19:00', min:7, max:9, t:'ASA', c:'Contemporary' },
      { d:'Thursday', n:'基础软开', s:'16:00', e:'17:00', min:5, max:6, t:'DEMI', c:'Technique' },
      { d:'Thursday', n:'舞团排练', s:'17:00', e:'18:00', min:4, max:6, t:'TARNIA', c:'Performance' },
      { d:'Thursday', n:'英皇芭蕾5级', s:'18:00', e:'19:00', min:9, max:10, t:'DEMI', c:'RAD' },
      { d:'Thursday', n:'HIPHOP 提高', s:'18:30', e:'20:00', min:9, max:15, t:'NANA', c:'HipHop' },
      { d:'Friday', n:'JAZZ 舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', c:'Jazz' },
      { d:'Friday', n:'HIPHOP L1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', c:'HipHop' },
      { d:'Friday', n:'K-POP 少儿', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', c:'Kpop' },
      { d:'Friday', n:'K-POP 青少', s:'18:00', e:'19:30', min:11, max:16, t:'JISOO', c:'Kpop' },
      { d:'Saturday', n:'英皇 Primary', s:'09:30', e:'11:00', min:5, max:6, t:'CARRIE', c:'RAD' },
      { d:'Saturday', n:'幼儿芭蕾', s:'11:00', e:'12:00', min:3, max:5, t:'DEMI', c:'Ballet' },
      { d:'Saturday', n:'K-POP', s:'11:00', e:'12:30', min:11, max:16, t:'HAZEL', c:'Kpop' },
      { d:'Saturday', n:'NZAMD Jazz L1', s:'12:00', e:'13:00', min:5, max:6, t:'KATIE', c:'Jazz' },
      { d:'Saturday', n:'PBT 进阶', s:'13:00', e:'14:00', min:7, max:8, t:'CARRIE', c:'Technique' },
      { d:'Sunday', n:'英皇 G1', s:'09:30', e:'10:30', min:7, max:99, t:'CARRIE', c:'RAD' },
      { d:'Sunday', n:'PBT 芭蕾', s:'10:30', e:'11:30', min:5, max:7, t:'CARRIE', c:'Technique' },
      { d:'Sunday', n:'OPEN 软开', s:'10:00', e:'11:00', min:9, max:99, t:'FORREST', c:'Technique' }
    ];

    for (const c of courses) {
      await pool.query(
        `INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [c.n, c.d, c.s, c.e, c.min, c.max, c.t, P_TERM, P_CASUAL, c.c]
      );
    }
    console.log('✅ Courses Seeded');
  } catch(e){ console.error(e); }
}

// === 6. 核心业务接口 ===

// --- 游戏相关 ---
function scanGames() {
  const games = {};
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      const dirs = fs.readdirSync(gamesDir);
      dirs.forEach(dir => {
          const jsonPath = path.join(gamesDir, dir, 'game.json');
          // 必须同时有 json 和 index.html
          if (fs.existsSync(jsonPath) && fs.existsSync(path.join(gamesDir, dir, 'index.html'))) {
              try {
                  const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                  games[dir] = { id: dir, title: meta.title, description: meta.description, thumbnail: meta.thumbnail, platform: 'mobile', entry: `/games/${dir}/index.html` };
              } catch(e) {}
          }
      });
  }
  // Demo
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
      games['demo'] = { id:'demo', title:'Demo Game', description:'Test', thumbnail:'', platform:'mobile', entry:'/games/demo-game.html' };
  }
  return Object.values(games);
}

app.get('/api/games', (req, res) => res.json(scanGames()));

app.get('/play/:id', (req, res) => {
  const gameId = req.params.id;
  const games = scanGames();
  const game = games.find(g => g.id === gameId);
  if (!game) return res.status(404).send('Game not found');
  if (!req.session.user) return res.redirect(`/?redirect=${encodeURIComponent('/play/' + gameId)}`);
  res.redirect(`/wrapper.html?src=${encodeURIComponent(game.entry)}`);
});

app.post('/api/score', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { gameId, score } = req.body;
  try {
    await pool.query('INSERT INTO scores (user_id, game_id, score) VALUES ($1,$2,$3)', [req.session.user.id, gameId, score]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Save failed' }); }
});

// --- AI 头像生成 ---
app.post('/api/generate-avatar', upload.single('faceImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    try {
        let avatarUrl = '';
        if (replicate) {
            console.log("Running Replicate...");
            const output = await replicate.run(
              "cjwbw/animeganv2:92da1447cb56306c66595b985f84a293505c743b783c5f2d94c26066556e6390",
              { input: { image: fs.createReadStream(req.file.path) } }
            );
            avatarUrl = output; // Replicate 返回的是 URL
        } else {
            console.log("Mocking AI...");
            await new Promise(r => setTimeout(r, 1500));
            const seed = req.session.user.student_name + Date.now();
            avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4`;
        }

        const config = req.session.user.avatar_config || {};
        config.aiAvatarUrl = avatarUrl;
        config.useAiAvatar = true;
        
        await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]);
        req.session.user.avatar_config = config;

        res.json({ success: true, url: avatarUrl, mode: replicate ? 'AI' : 'Mock' });
    } catch (e) {
        console.error("Gen Error:", e.message);
        res.status(500).json({ error: e.message || 'Server Error' });
    }
});

app.post('/api/save-avatar', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    const { config } = req.body;
    try {
        await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]);
        req.session.user.avatar_config = config;
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Failed' }); }
});

// --- 奖杯上传 (OCR) ---
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const imagePath = '/uploads/' + req.file.filename;
    const userName = (req.session.user.student_name || "").toLowerCase();
    const nameParts = userName.split(' ').filter(p => p.length > 1); 

    Tesseract.recognize(req.file.path, 'eng')
        .then(async ({ data: { text } }) => {
            const clean = text.toLowerCase();
            
            // 名字校验 (可选：取消注释开启严格校验)
            // const nameMatch = nameParts.some(part => clean.includes(part));
            // if (!nameMatch) return res.json({ success: false, error: 'Name not found on certificate' });

            let type = 'certificate'; 
            let source = 'Award';
            let coins = 10; 

            if (clean.includes('gold') || clean.includes('1st') || clean.includes('distinction')) { type = 'gold'; coins = 100; }
            else if (clean.includes('silver') || clean.includes('2nd') || clean.includes('merit')) { type = 'silver'; coins = 50; }
            else if (clean.includes('bronze') || clean.includes('3rd')) { type = 'bronze'; coins = 30; }

            if (clean.includes('rad')) source = 'RAD Ballet';
            else if (clean.includes('nzamd')) source = 'NZAMD Jazz';

            await pool.query(`INSERT INTO user_trophies (user_id, image_path, ocr_text, trophy_type, source_name) VALUES ($1,$2,$3,$4,$5)`, 
                [req.session.user.id, imagePath, text, type, source]);
            await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, req.session.user.id]);
            
            res.json({ success: true, type, source, coins });
        })
        .catch(err => { res.status(500).json({ error: 'OCR Error' }); });
});

app.get('/api/my-trophies', async (req, res) => {
    if (!req.session.user) return res.json([]);
    try { const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1 ORDER BY created_at DESC', [req.session.user.id]); res.json(r.rows); } catch(e) { res.json([]); }
});

// --- 课程报名 ---
app.get('/api/courses/recommended', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Login required' });
  try {
    const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]);
    const dob = new Date(u.rows[0].dob);
    let age = new Date().getFullYear() - dob.getFullYear();
    if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--;
    const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]);
    res.json({ age, courses: list.rows });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/book-course', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Login required' });
  const { courseId, type, selectedDates, totalPrice } = req.body; 
  const userId = req.session.user.id;

  try {
    const existing = await pool.query("SELECT booking_type, selected_dates FROM bookings WHERE user_id=$1 AND course_id=$2 AND status != 'cancelled'", [userId, courseId]);
    if (existing.rows.some(r => r.booking_type === 'term')) return res.json({ success: false, message: 'Already booked Full Term' });
    if (type === 'term' && existing.rows.length > 0) return res.json({ success: false, message: 'Partially booked' });
    if (type === 'casual' && selectedDates) {
        const newDates = new Set(selectedDates);
        for (const row of existing.rows) {
            if (row.selected_dates) {
                const oldDates = row.selected_dates.split(',');
                for (const d of oldDates) if (newDates.has(d)) return res.json({ success: false, message: `Date ${d} already booked` });
            }
        }
    }
    if (type === 'makeup') {
        const uRes = await pool.query('SELECT makeup_credits FROM users WHERE id=$1', [userId]);
        if (uRes.rows[0].makeup_credits <= 0) return res.json({success:false, message:'No makeup credits'});
        await pool.query('UPDATE users SET makeup_credits = makeup_credits - 1 WHERE id=$1', [userId]);
    }
    const u = await pool.query('SELECT student_name FROM users WHERE id=$1', [userId]);
    const status = type === 'makeup' ? 'PAID' : 'UNPAID';
    const isMakeup = type === 'makeup';
    const price = type === 'makeup' ? 0 : totalPrice;
    await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status, is_makeup) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [userId, courseId, u.rows[0].student_name, price, type, selectedDates?selectedDates.join(','):'', status, isMakeup]);
    res.json({ success: true, message: 'Booking Success!' });
  } catch(e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/cancel-booking', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Login' });
  const { bookingId } = req.body;
  try {
    const check = await pool.query('SELECT status FROM bookings WHERE id=$1 AND user_id=$2', [bookingId, req.session.user.id]);
    if (check.rows.length === 0) return res.json({ success: false, message: 'Order not found' });
    if (check.rows[0].status !== 'UNPAID') return res.json({ success: false, message: 'Cannot cancel paid order' });
    await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/my-schedule', async (req, res) => { if(!req.session.user) return res.status(401).json({error:'Login'}); try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.id as booking_id, b.is_makeup FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){ res.status(500).json({error:'Error'}); } });
app.get('/api/my-invoices', async (req, res) => { try { const r = await pool.query(`SELECT b.*, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });

// --- 老师端 ---
app.get('/api/teacher/schedule', async (req, res) => { try { const result = await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM bookings b WHERE b.course_id = c.id) as student_count FROM courses c ORDER BY CASE WHEN day_of_week='Monday' THEN 1 WHEN day_of_week='Tuesday' THEN 2 WHEN day_of_week='Wednesday' THEN 3 WHEN day_of_week='Thursday' THEN 4 WHEN day_of_week='Friday' THEN 5 WHEN day_of_week='Saturday' THEN 6 ELSE 7 END, start_time`); res.json(result.rows); } catch(e) { res.status(500).json({error: e.message}); } });
app.get('/api/teacher/bookings/:courseId', async (req, res) => { const { courseId } = req.params; const r = await pool.query(`SELECT b.id, b.status, b.is_makeup, b.selected_dates, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.course_id = $1`, [courseId]); res.json(r.rows); });
app.post('/api/teacher/action', async (req, res) => { const { bookingId, courseId, action } = req.body; try { const c = (await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id=$1', [courseId])).rows[0]; const bRes = await pool.query('SELECT user_id FROM bookings WHERE id=$1', [bookingId]); const userId = bRes.rows[0].user_id; if (action === 'present') { const [sH, sM] = c.start_time.split(':').map(Number); const [eH, eM] = c.end_time.split(':').map(Number); const duration = (eH*60 + eM) - (sH*60 + sM); await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,$5,'attended', NOW())`, [userId, courseId, c.name, c.category, duration]); await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]); await pool.query("UPDATE bookings SET status = 'attended' WHERE id = $1", [bookingId]); res.json({ success: true, msg: `+${duration}min` }); } else if (action === 'absent') { await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,0,'absent', NOW())`, [userId, courseId, c.name, c.category]); await pool.query(`UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id = $1`, [userId]); res.json({ success: true, msg: 'Credit +1' }); } } catch(e) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/teacher/remove-booking', async (req, res) => { const { bookingId } = req.body; try { const check = await pool.query('SELECT user_id, is_makeup FROM bookings WHERE id=$1', [bookingId]); if (check.rows.length > 0 && check.rows[0].is_makeup) { await pool.query('UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id=$1', [check.rows[0].user_id]); } await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]); res.json({ success: true }); } catch(e) { res.status(500).json({ error: 'Error' }); } });

// --- 用户管理 ---
app.post('/api/register', async (req, res) => { const { email, password, studentName, dob, agreedToTerms } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob, agreed_terms) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, student_name`, [email, hash, studentName, dob, agreedToTerms]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/login', async (req, res) => { const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.get('/api/me', async (req, res) => { if(!req.session.user) return res.json(null); const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]); req.session.user = r.rows[0]; res.json(r.rows[0]); });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/ai-report', async (req, res) => { if(!req.session.user) return res.status(401).json({error:'Login'}); try { const stats = await pool.query(`SELECT category, SUM(duration_minutes) as total FROM attendance_logs WHERE user_id=$1 GROUP BY category`, [req.session.user.id]); res.json({timeStats: stats.rows, aiAnalysis: {warnings:[], recommendations:[]}}); } catch(e) { res.status(500).json({error:'Error'}); } });

// 路由
const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html','avatar_editor.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));