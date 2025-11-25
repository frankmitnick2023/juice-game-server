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

// === AI 容错初始化 ===
let replicate = null;
try {
    // 只有当环境变量存在且格式正确时才初始化真实客户端
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
  secret: 'juice-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.static('public'));

app.use('/games', express.static(path.join(__dirname, 'games'), { setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*') }));
app.use('/uploads', express.static('uploads'));
app.use('/avatars', express.static(path.join(__dirname, 'public', 'avatars'))); // 再次确保路径正确

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
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0, makeup_credits INTEGER DEFAULT 0, avatar_config JSONB DEFAULT '{}')`);
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0', "avatar_config JSONB DEFAULT '{}'"];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT DEFAULT 'General')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT DEFAULT 'term', selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);
    
    console.log('✅ DB Schema Verified');
    initAllCourses();
  } catch (err) { console.error('DB Error:', err); }
})();

async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return;
    // ... 省略具体的课程录入代码，保持原样 ...
  } catch(e){}
}

// === API ===
function scanGames() { /* ...保持原样... */ return []; } // 实际部署请用完整版 scanGames
app.get('/api/games', (req, res) => {
    // 简易版 scanGames，防报错
    const gamesDir = path.join(__dirname, 'games');
    const games = [];
    if (fs.existsSync(gamesDir)) {
        fs.readdirSync(gamesDir).forEach(dir => {
            const p = path.join(gamesDir, dir, 'game.json');
            if(fs.existsSync(p)) {
                try { games.push({id:dir, ...JSON.parse(fs.readFileSync(p))}); } catch(e){}
            }
        });
    }
    res.json(games);
});

// === AI 生成接口 (强力防崩版) ===
app.post('/api/generate-avatar', upload.single('faceImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    
    try {
        // 1. 检查文件
        if (!req.file) throw new Error('No file uploaded');

        let avatarUrl = '';

        // 2. 判断是否可用真实 AI
        if (replicate) {
            console.log("Running Replicate...");
            const output = await replicate.run(
              "cjwbw/animeganv2:92da1447cb56306c66595b985f84a293505c743b783c5f2d94c26066556e6390",
              { input: { image: fs.createReadStream(req.file.path) } }
            );
            avatarUrl = output;
        } else {
            // 3. 模拟模式
            console.log("Using Mock Mode...");
            await new Promise(r => setTimeout(r, 1500)); // 假装思考
            const seed = req.session.user.student_name + Date.now();
            avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}&backgroundColor=b6e3f4`;
        }

        // 4. 保存配置
        const config = req.session.user.avatar_config || {};
        config.aiAvatarUrl = avatarUrl;
        config.useAiAvatar = true;
        
        await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]);
        req.session.user.avatar_config = config;

        res.json({ success: true, url: avatarUrl, mode: replicate ? 'AI' : 'Mock' });

    } catch (e) {
        console.error("Gen Error:", e.message);
        // 返回 200 但带 success:false，方便前端 alert 错误，而不是直接红字报错
        res.json({ success: false, error: e.message || 'Server Error' });
    }
});

// 其他标准接口保持不变...
app.post('/api/save-avatar', async (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Login' }); const { config } = req.body; await pool.query('UPDATE users SET avatar_config = $1 WHERE id = $2', [config, req.session.user.id]); req.session.user.avatar_config = config; res.json({ success: true }); });
app.get('/api/me', async (req, res) => { if(!req.session.user) return res.json(null); const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]); req.session.user = r.rows[0]; res.json(r.rows[0]); });
// ... (Login, Register, Book, etc.)

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// ... (Routes)

app.listen(process.env.PORT || 3000, () => console.log('Server running'));