require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Replicate = require('replicate');
const app = express();

// === AI 初始化 ===
let replicate = null;
try {
    if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN.startsWith('r8_')) {
        replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
        console.log("✅ AI Client Ready");
    }
} catch (e) {}

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

// 静态资源与上传
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
    // 1. 基础表
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT)`);
    const uCols = ['level INTEGER DEFAULT 1', 'coins INTEGER DEFAULT 0', 'student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0', "avatar_config JSONB DEFAULT '{}'"];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT)`);
    const cCols = ['day_of_week TEXT', 'start_time TEXT', 'end_time TEXT', 'min_age INTEGER DEFAULT 0', 'max_age INTEGER DEFAULT 99', 'teacher TEXT', 'price DECIMAL(10,2) DEFAULT 0', 'casual_price DECIMAL(10,2) DEFAULT 0', "category TEXT DEFAULT 'General'"];
    for(const c of cCols) await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS ${c}`);

    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER)`);
    const bCols = ['course_id INTEGER', 'student_name TEXT', "status TEXT DEFAULT 'UNPAID'", 'price_snapshot DECIMAL(10,2) DEFAULT 0', "booking_type TEXT DEFAULT 'term'", 'selected_dates TEXT', 'is_makeup BOOLEAN DEFAULT FALSE', 'created_at TIMESTAMP DEFAULT NOW()'];
    for(const c of bCols) await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ${c}`);

    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER)`);
    const lCols = ['course_id INTEGER', 'course_name TEXT', 'category TEXT', 'duration_minutes INTEGER', "status TEXT DEFAULT 'attended'", 'check_in_time TIMESTAMP DEFAULT NOW()'];
    for(const c of lCols) await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS ${c}`);

    // 2. 奖杯表 (关键升级：增加 status 字段)
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER)`);
    const tCols = ['image_path TEXT', 'ocr_text TEXT', 'trophy_type TEXT', 'source_name TEXT', "status TEXT DEFAULT 'pending'", 'created_at TIMESTAMP DEFAULT NOW()'];
    for(const c of tCols) await pool.query(`ALTER TABLE user_trophies ADD COLUMN IF NOT EXISTS ${c}`);

    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ DB Ready');
    initAllCourses();
  } catch (err) { console.error('DB Error:', err.message); }
})();

async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return;
    
    const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', c:'RAD' },
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', c:'Jazz' },
      { d:'Friday', n:'K-POP (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', c:'Kpop' }
    ];
    for (const c of courses) {
      await pool.query(`INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) VALUES ($1,$2,$3,$4,$5,$6,$7,230,25,$8)`, [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.c]);
    }
  } catch(e){}
}

// === API ===

// 1. 奖杯上传 (纯上传，不识别，不发奖)
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const imagePath = '/uploads/' + req.file.filename;
    
    try {
        // 直接存入数据库，状态为 pending
        await pool.query(
            `INSERT INTO user_trophies (user_id, image_path, status, source_name) 
             VALUES ($1, $2, 'pending', 'Waiting for review')`, 
            [req.session.user.id, imagePath]
        );
        
        res.json({ success: true, message: 'Upload successful. Waiting for teacher review.' });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// 2. 获取我的奖杯 (只返回已审核通过的)
app.get('/api/my-trophies', async (req, res) => {
    if (!req.session.user) return res.json([]);
    try {
        const r = await pool.query("SELECT * FROM user_trophies WHERE user_id=$1 AND status='approved' ORDER BY created_at DESC", [req.session.user.id]);
        res.json(r.rows);
    } catch(e) { res.json([]); }
});

// 3. 管理员：获取待审核列表
app.get('/api/admin/trophies/pending', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT t.*, u.student_name 
            FROM user_trophies t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.status = 'pending' 
            ORDER BY t.created_at ASC
        `);
        res.json(r.rows);
    } catch(e) { res.status(500).json({error:e.message}); }
});

// 4. 管理员：审核发奖
app.post('/api/admin/trophies/approve', async (req, res) => {
    const { trophyId, action, type, sourceName } = req.body; 
    // action: 'approve' | 'reject'
    
    try {
        if (action === 'reject') {
            await pool.query("UPDATE user_trophies SET status='rejected' WHERE id=$1", [trophyId]);
            return res.json({ success: true });
        }

        if (action === 'approve') {
            // 更新状态
            const r = await pool.query(
                "UPDATE user_trophies SET status='approved', trophy_type=$1, source_name=$2 WHERE id=$3 RETURNING user_id", 
                [type, sourceName, trophyId]
            );
            
            // 发放金币
            const userId = r.rows[0].user_id;
            const coins = type==='gold'?100 : (type==='silver'?50 : 30);
            await pool.query("UPDATE users SET coins = coins + $1 WHERE id=$2", [coins, userId]);
            
            res.json({ success: true, coins: coins });
        }
    } catch(e) { res.status(500).json({error:e.message}); }
});


// 其他接口 (保持功能)
function scanGames() { /* 略 */ const games = {}; const gamesDir = path.join(__dirname, 'games'); if (fs.existsSync(gamesDir)) { fs.readdirSync(gamesDir).forEach(dir => { const p = path.join(gamesDir, dir, 'game.json'); if(fs.existsSync(p)) { try { games[dir] = {id:dir, ...JSON.parse(fs.readFileSync(p)), entry:`/games/${dir}/index.html`}; } catch(e){} } }); } return Object.values(games); }
app.get('/api/games', (req, res) => res.json(scanGames()));
app.get('/play/:id', (req, res) => { const game = scanGames().find(g => g.id === req.params.id); if(!game) return res.status(404).send('Not found'); res.redirect(`/wrapper.html?src=${encodeURIComponent(game.entry)}`); });
app.post('/api/generate-avatar', upload.single('faceImage'), async (req, res) => {
    // AI 生成逻辑 (带降级)
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
        let avatarUrl = '';
        let mode = 'Mock';
        if (replicate) {
            const output = await replicate.run("fofr/face-to-many:a07f252abbbd4328866205a5ef85b737cf775416869d146691534557c51214b6", { input: { image: fs.createReadStream(req.file.path), style:"video_game", prompt:"cute chibi" } });
            avatarUrl = Array.isArray(output) ? output[0] : output;
            mode = 'AI';
        } else {
            await new Promise(r => setTimeout(r, 1500));
            const seed = req.session.user.student_name + Date.now();
            avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4`;
            mode = 'Fallback';
        }
        const config = req.session.user.avatar_config || {};
        config.aiAvatarUrl = avatarUrl;
        config.useAiAvatar = true;
        await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]);
        req.session.user.avatar_config = config;
        res.json({ success: true, url: avatarUrl, mode });
    } catch (e) { res.status(500).json({ error: 'Gen Failed' }); }
});

// 常规业务接口
app.post('/api/save-avatar', async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login' }); const { config } = req.body; await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]); req.session.user.avatar_config = config; res.json({ success: true }); });
app.get('/api/me', async (req, res) => { if(!req.session.user) return res.json(null); const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]); req.session.user = r.rows[0]; res.json(r.rows[0]); });
app.post('/api/register', async (req, res) => { const { email, password, studentName, dob, agreedToTerms } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob, agreed_terms) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, student_name`, [email, hash, studentName, dob, agreedToTerms]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/login', async (req, res) => { const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/courses/recommended', async (req, res) => { try { const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]); const dob = new Date(u.rows[0].dob); let age = new Date().getFullYear() - dob.getFullYear(); if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--; const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]); res.json({ age, courses: list.rows }); } catch (err) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/book-course', async (req, res) => { const { courseId, type, totalPrice, selectedDates } = req.body; const userId = req.session.user.id; try { /* 查重逻辑... */ const u = await pool.query('SELECT student_name FROM users WHERE id=$1', [userId]); await pool.query(`INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status) VALUES ($1,$2,$3,$4,$5,$6,'UNPAID')`, [userId, courseId, u.rows[0].student_name, type==='makeup'?0:totalPrice, type, selectedDates?selectedDates.join(','):'']); res.json({success:true}); } catch(e) { res.status(500).json({error:'Failed'}); } });
app.get('/api/my-schedule', async (req, res) => { try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.id as booking_id FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){ res.status(500).json({error:'Error'}); } });
app.get('/api/my-invoices', async (req, res) => { try { const r = await pool.query(`SELECT b.*, c.name as course_name FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });
app.get('/api/teacher/schedule', async (req, res) => { try { const result = await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM bookings b WHERE b.course_id = c.id) as student_count FROM courses c ORDER BY start_time`); res.json(result.rows); } catch(e) { res.status(500).json({error: e.message}); } });
app.get('/api/teacher/bookings/:courseId', async (req, res) => { const { courseId } = req.params; const r = await pool.query(`SELECT b.id, b.status, b.is_makeup, b.selected_dates, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.course_id = $1`, [courseId]); res.json(r.rows); });
app.post('/api/teacher/action', async (req, res) => { const { bookingId, courseId, action } = req.body; try { const c = (await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id=$1', [courseId])).rows[0]; const bRes = await pool.query('SELECT user_id FROM bookings WHERE id=$1', [bookingId]); const userId = bRes.rows[0].user_id; if (action === 'present') { const [sH, sM] = c.start_time.split(':').map(Number); const [eH, eM] = c.end_time.split(':').map(Number); const duration = (eH*60 + eM) - (sH*60 + sM); await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,$5,'attended', NOW())`, [userId, courseId, c.name, c.category, duration]); await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]); await pool.query("UPDATE bookings SET status = 'attended' WHERE id = $1", [bookingId]); res.json({ success: true, msg: `+${duration}min` }); } else if (action === 'absent') { await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,0,'absent', NOW())`, [userId, courseId, c.name, c.category]); await pool.query(`UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id = $1`, [userId]); res.json({ success: true, msg: 'Credit +1' }); } } catch(e) { res.status(500).json({ error: 'Error' }); } });
app.post('/api/teacher/remove-booking', async (req, res) => { const { bookingId } = req.body; await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]); res.json({ success: true }); });
app.post('/api/cancel-booking', async (req, res) => { const { bookingId } = req.body; await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]); res.json({ success: true }); });
app.get('/api/ai-report', async (req, res) => { res.json({timeStats:[], aiAnalysis:{warnings:[], recommendations:[]}}); });

const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html','avatar_editor.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));