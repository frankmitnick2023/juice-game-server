const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // 处理上传
const Tesseract = require('tesseract.js'); // OCR识别
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
// 公开上传文件夹，以便前端能显示上传的图片
app.use('/uploads', express.static('uploads'));

// === 上传配置 ===
// 确保上传目录存在
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

// === 数据库初始化 ===
(async () => {
  try {
    // 用户表
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0, makeup_credits INTEGER DEFAULT 0)`);
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0'];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 基础业务表 (课程、报名、日志、分数)
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT, selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);

    // === 新增：奖杯表 ===
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_trophies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        image_path TEXT,
        ocr_text TEXT,
        trophy_type TEXT, -- 'gold', 'silver', 'bronze'
        source_name TEXT, -- 'RAD Grade 1', 'Competition' etc.
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('DB Initialized');
    initAllCourses(); 
  } catch (err) { console.error('DB Init Error:', err); }
})();

// === 课表初始化 (保持不变) ===
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
  } catch (e) {}
}

// === 核心功能 API ===

// 1. 奖杯上传与识别 (OCR)
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const imagePath = '/uploads/' + req.file.filename;
    const fullPath = req.file.path;

    try {
        console.log('开始识别图片:', fullPath);
        
        // 调用 Tesseract 进行识别 (英文模式)
        const { data: { text } } = await Tesseract.recognize(fullPath, 'eng');
        const cleanText = text.toLowerCase();
        console.log('识别结果:', cleanText);

        // 智能判定逻辑
        let type = 'bronze';
        let source = 'Certificate';

        if (cleanText.includes('gold') || cleanText.includes('distinction') || cleanText.includes('1st') || cleanText.includes('winner')) {
            type = 'gold';
        } else if (cleanText.includes('silver') || cleanText.includes('merit') || cleanText.includes('2nd')) {
            type = 'silver';
        }

        // 提取一些关键词作为来源描述 (简单版)
        if (cleanText.includes('rad')) source = 'RAD Ballet';
        else if (cleanText.includes('nzamd')) source = 'NZAMD Jazz';
        else if (cleanText.includes('competition')) source = 'Competition';

        // 存入数据库
        await pool.query(
            `INSERT INTO user_trophies (user_id, image_path, ocr_text, trophy_type, source_name) 
             VALUES ($1, $2, $3, $4, $5)`,
            [req.session.user.id, imagePath, text, type, source]
        );

        // 可选：给一点金币奖励
        const coinReward = type === 'gold' ? 100 : (type === 'silver' ? 50 : 20);
        await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coinReward, req.session.user.id]);

        res.json({ success: true, type: type, source: source, coins: coinReward });

    } catch (error) {
        console.error('OCR Error:', error);
        res.status(500).json({ error: '识别失败，请上传清晰的图片' });
    }
});

// 2. 获取我的奖杯列表
app.get('/api/my-trophies', async (req, res) => {
    if (!req.session.user) return res.json([]);
    try {
        const r = await pool.query('SELECT * FROM user_trophies WHERE user_id = $1 ORDER BY created_at DESC', [req.session.user.id]);
        res.json(r.rows);
    } catch (e) { res.json([]); }
});

// === 现有其他 API (保持不变) ===
function scanGames() { /* ...略... */ return []; } 
app.get('/api/games', (req, res) => {
    // 这里简写了，实际请保留之前的 scanGames 逻辑
    // 为了不让代码太长，我这里返回一些 Mock 数据，您部署时请用之前的完整 scanGames 函数
    const mockGames = [
        {id:'ballet-pro', title:'Ballet Pro', thumbnail:'', entry:''},
        {id:'rhythm', title:'Rhythm Master', thumbnail:'', entry:''}
    ];
    res.json(mockGames);
});

app.post('/api/register', async (req, res) => { /* ... */ });
app.post('/api/login', async (req, res) => { /* ... */ });
app.get('/api/me', async (req, res) => {
    if(!req.session.user) return res.json(null);
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]);
    res.json(r.rows[0]);
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/courses/recommended', async (req, res) => { /* ... */ });
app.post('/api/book-course', async (req, res) => { /* ... */ });
app.get('/api/my-schedule', async (req, res) => { /* ... */ });
app.get('/api/teacher/schedule', async (req, res) => { /* ... */ });
app.get('/api/teacher/bookings/:courseId', async (req, res) => { /* ... */ });
app.post('/api/teacher/action', async (req, res) => { /* ... */ });
app.get('/api/ai-report', async (req, res) => { /* ... */ });

// 路由
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/timetable.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'timetable.html')));
app.get('/my_schedule.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my_schedule.html')));
app.get('/invoices.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoices.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/stats.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stats.html')));
app.get('/growth.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'growth.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));