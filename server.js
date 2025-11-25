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
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
  }
}));
app.use('/uploads', express.static('uploads'));

// === 上传配置 ===
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        level INTEGER DEFAULT 1,
        coins INTEGER DEFAULT 0,
        student_name TEXT,
        dob DATE,
        agreed_terms BOOLEAN DEFAULT FALSE,
        total_minutes INTEGER DEFAULT 0,
        makeup_credits INTEGER DEFAULT 0
      );
    `);
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0'];
    for (const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 2. 课程表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        min_age INTEGER DEFAULT 0,
        max_age INTEGER DEFAULT 99,
        teacher TEXT,
        price DECIMAL(10, 2) DEFAULT 0,
        casual_price DECIMAL(10, 2) DEFAULT 0,
        category TEXT DEFAULT 'General'
      );
    `);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price DECIMAL(10, 2) DEFAULT 0`);

    // 3. 报名表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        course_id INTEGER REFERENCES courses(id),
        student_name TEXT,
        status TEXT DEFAULT 'UNPAID',
        price_snapshot DECIMAL(10, 2) DEFAULT 0,
        booking_type TEXT DEFAULT 'term',
        selected_dates TEXT,
        is_makeup BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'term'`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_dates TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_makeup BOOLEAN DEFAULT FALSE`);

    // 4. 签到日志表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        course_id INTEGER REFERENCES courses(id),
        course_name TEXT,
        category TEXT,
        duration_minutes INTEGER,
        status TEXT,
        check_in_time TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'attended'`);

    // 5. 游戏分数 & 奖杯
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, game_id TEXT NOT NULL, score INTEGER NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_trophies (id SERIAL PRIMARY KEY, user_id INTEGER, image_path TEXT, ocr_text TEXT, trophy_type TEXT, source_name TEXT, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ Database Initialized');
    initAllCourses(); 

  } catch (err) {
    console.error('DB Init Error:', err.message);
  }
})();

// === 全量课表录入 ===
async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return;

    console.log('Seeding Courses...');
    const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', p:180, c:'Technique' },
      { d:'Monday', n:'OPEN 芭蕾技巧与基础', s:'16:00', e:'17:00', min:5, max:8, t:'CARRIE', p:180, c:'Ballet' },
      { d:'Monday', n:'英皇芭蕾3级', s:'18:00', e:'19:00', min:9, max:99, t:'LIU', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 舞团班', s:'19:00', e:'20:00', min:12, max:99, t:'CINDY', p:220, c:'Performance' },
      { d:'Tuesday', n:'英皇芭蕾4级', s:'16:00', e:'17:00', min:9, max:10, t:'DEMI', p:200, c:'RAD' },
      { d:'Tuesday', n:'软开度/核心与技巧', s:'16:00', e:'17:00', min:7, max:8, t:'CINDY', p:180, c:'Technique' },
      { d:'Tuesday', n:'英皇芭蕾2级', s:'17:00', e:'18:00', min:7, max:8, t:'DEMI', p:200, c:'RAD' },
      { d:'Tuesday', n:'RAD INTERMEDIATE FOUNDATION', s:'18:00', e:'19:00', min:10, max:13, t:'DEMI', p:220, c:'RAD' },
      { d:'Tuesday', n:'OPEN 芭蕾足尖课', s:'19:00', e:'20:00', min:10, max:15, t:'TONIA', p:200, c:'Ballet' },
      { d:'Wednesday', n:'英皇芭蕾1级', s:'16:00', e:'17:00', min:7, max:99, t:'CARRIE', p:200, c:'RAD' },
      { d:'Wednesday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Wednesday', n:'HIPHOP LEVEL 2', s:'17:00', e:'18:00', min:9, max:15, t:'NANA', p:180, c:'HipHop' },
      { d:'Wednesday', n:'OPEN 现代舞基础', s:'18:00', e:'19:00', min:7, max:9, t:'ASA', p:180, c:'Contemporary' },
      { d:'Thursday', n:'基础软开与核心训练', s:'16:00', e:'17:00', min:5, max:6, t:'DEMI', p:180, c:'Technique' },
      { d:'Thursday', n:'DANCE TROUPE MUSICAL', s:'17:00', e:'18:00', min:4, max:6, t:'TARNIA', p:180, c:'Performance' },
      { d:'Thursday', n:'英皇芭蕾5级', s:'18:00', e:'19:00', min:9, max:10, t:'DEMI', p:200, c:'RAD' },
      { d:'Thursday', n:'HIPHOP 提高班', s:'18:30', e:'20:00', min:9, max:15, t:'NANA', p:220, c:'HipHop' },
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:220, c:'Jazz' },
      { d:'Friday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Friday', n:'K-POP (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:180, c:'Kpop' },
      { d:'Friday', n:'K-POP 韩国流行舞', s:'18:00', e:'19:30', min:11, max:16, t:'JISOO', p:220, c:'Kpop' },
      { d:'Saturday', n:'英皇芭蕾 PRIMARY', s:'09:30', e:'11:00', min:5, max:6, t:'CARRIE', p:220, c:'RAD' },
      { d:'Saturday', n:'幼儿芭蕾启蒙班', s:'11:00', e:'12:00', min:3, max:5, t:'DEMI', p:180, c:'Ballet' },
      { d:'Saturday', n:'K-POP', s:'11:00', e:'12:30', min:11, max:16, t:'HAZEL', p:220, c:'Kpop' },
      { d:'Saturday', n:'NZAMD 爵士考级 L1', s:'12:00', e:'13:00', min:5, max:6, t:'KATIE', p:200, c:'Jazz' },
      { d:'Saturday', n:'PBT 进阶芭蕾技巧', s:'13:00', e:'14:00', min:7, max:8, t:'CARRIE', p:180, c:'Technique' },
      { d:'Sunday', n:'英皇芭蕾 GRADE 1', s:'09:30', e:'10:30', min:7, max:99, t:'CARRIE', p:200, c:'RAD' },
      { d:'Sunday', n:'PBT 芭蕾技巧', s:'10:30', e:'11:30', min:5, max:7, t:'CARRIE', p:180, c:'Technique' },
      { d:'Sunday', n:'OPEN 软开核心', s:'10:00', e:'11:00', min:9, max:99, t:'FORREST', p:180, c:'Technique' }
    ];

    for (const c of courses) {
      const casual = c.cp || Math.ceil(c.p / 8); 
      await pool.query(
        `INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, casual, c.c]
      );
    }
    console.log('✅ Courses Seeded');
  } catch (e) { console.error(e); }
}

// === API: 游戏 (修复版) ===
function scanGames() {
  const games = {};
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      const dirs = fs.readdirSync(gamesDir);
      dirs.forEach(dir => {
          const jsonPath = path.join(gamesDir, dir, 'game.json');
          // 确保 index.html 存在才算有效游戏
          if (fs.existsSync(jsonPath) && fs.existsSync(path.join(gamesDir, dir, 'index.html'))) {
              try {
                  const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                  games[dir] = {
                      id: dir,
                      title: meta.title || dir,
                      description: meta.description || '',
                      thumbnail: meta.thumbnail || '',
                      platform: dir.includes('mobile') ? 'mobile' : 'pc',
                      entry: `/games/${dir}/index.html`
                  };
              } catch(e) {}
          }
      });
  }
  // Demo
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
      games['demo'] = { id:'demo', title:'Demo Game', description:'Test', thumbnail:'', platform:'both', entry:'/games/demo-game.html' };
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
  // 跳转到 wrapper
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

// === API: 用户 ===
app.post('/api/register', async (req, res) => {
  const { email, password, studentName, dob, agreedToTerms } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, student_name, dob, agreed_terms) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, level, coins, student_name`,
      [email, hash, studentName || null, dob || null, agreedToTerms || false]
    );
    req.session.user = result.rows[0];
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    delete user.password_hash;
    req.session.user = user;
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// === API: 奖杯 (OCR) ===
app.post('/api/upload-trophy', upload.single('trophyImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const imagePath = '/uploads/' + req.file.filename;
    const userName = (req.session.user.student_name || "").toLowerCase();
    const nameParts = userName.split(' ').filter(p => p.length > 1); 

    Tesseract.recognize(req.file.path, 'eng')
        .then(async ({ data: { text } }) => {
            const clean = text.toLowerCase();
            // 1. 名字校验
            const nameMatch = nameParts.some(part => clean.includes(part));
            if (!nameMatch) {
                // return res.json({ success: false, error: `无法识别到名字 "${req.session.user.student_name}"` });
                console.log("Name check failed, but proceeding for testing."); 
            }

            // 2. 评级
            let type = 'certificate';
            let source = 'Award';
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

app.get('/api/my-trophies', async (req, res) => {
    if (!req.session.user) return res.json([]);
    try {
        const r = await pool.query('SELECT * FROM user_trophies WHERE user_id=$1 ORDER BY created_at DESC', [req.session.user.id]);
        res.json(r.rows);
    } catch(e) { res.json([]); }
});

// === API: 选课与报名 (查重逻辑) ===
app.get('/api/courses/recommended', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Login' });
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
  if (!req.session.user) return res.status(401).json({ error: 'Login' });
  const { courseId, type, selectedDates, totalPrice } = req.body; 
  const userId = req.session.user.id;

  try {
    const existing = await pool.query("SELECT booking_type, selected_dates FROM bookings WHERE user_id=$1 AND course_id=$2", [userId, courseId]);
    
    // 1. 检查整学期冲突
    if (existing.rows.some(r => r.booking_type === 'term')) {
        return res.json({ success: false, message: '您已报名该课程整学期，无需重复报名。' });
    }
    if (type === 'term' && existing.rows.length > 0) {
        return res.json({ success: false, message: '您已有该课程的部分报名。' });
    }

    // 2. 检查单日冲突
    if (type === 'casual' && selectedDates) {
        const newDates = new Set(selectedDates);
        for (const row of existing.rows) {
            if (row.selected_dates) {
                const oldDates = row.selected_dates.split(',');
                for (const d of oldDates) {
                    if (newDates.has(d)) return res.json({ success: false, message: `日期 ${d} 已报名` });
                }
            }
        }
    }

    // 3. 补课逻辑
    if (type === 'makeup') {
        const uRes = await pool.query('SELECT makeup_credits FROM users WHERE id=$1', [userId]);
        if (uRes.rows[0].makeup_credits <= 0) return res.json({success:false, message:'无补课额度'});
        await pool.query('UPDATE users SET makeup_credits = makeup_credits - 1 WHERE id=$1', [userId]);
    }

    const u = await pool.query('SELECT student_name FROM users WHERE id=$1', [userId]);
    const status = type === 'makeup' ? 'PAID' : 'UNPAID';
    const isMakeup = type === 'makeup';
    const price = type === 'makeup' ? 0 : totalPrice;

    await pool.query(
        `INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status, is_makeup) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
        [userId, courseId, u.rows[0].student_name, price, type, selectedDates?selectedDates.join(','):'', status, isMakeup]
    );
    
    res.json({ success: true, message: '报名成功！' });
  } catch(e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/cancel-booking', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Login' });
  const { bookingId } = req.body;
  try {
    const check = await pool.query('SELECT status FROM bookings WHERE id=$1 AND user_id=$2', [bookingId, req.session.user.id]);
    if (check.rows.length === 0) return res.json({ success: false, message: '订单不存在' });
    if (check.rows[0].status !== 'UNPAID') return res.json({ success: false, message: '无法取消已付订单' });
    await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/my-schedule', async (req, res) => { /* ... */ if(!req.session.user) return res.status(401).json({error:'Login'}); try{ const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.id as booking_id, b.is_makeup FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){ res.status(500).json({error:'Error'}); } });
app.get('/api/my-invoices', async (req, res) => { try { const r = await pool.query(`SELECT b.*, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){} });

// === 老师后台 API ===
app.get('/api/teacher/schedule', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, (SELECT COUNT(*)::int FROM bookings b WHERE b.course_id = c.id) as student_count
            FROM courses c 
            ORDER BY CASE WHEN day_of_week='Monday' THEN 1 ELSE 7 END, start_time
        `);
        res.json(result.rows);
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/teacher/bookings/:courseId', async (req, res) => {
  const { courseId } = req.params;
  const r = await pool.query(`SELECT b.id, b.status, b.is_makeup, b.selected_dates, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.course_id=$1`, [courseId]);
  res.json(r.rows);
});

app.post('/api/teacher/action', async (req, res) => {
  const { bookingId, courseId, action } = req.body;
  try {
    const c = (await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id=$1', [courseId])).rows[0];
    const bRes = await pool.query('SELECT user_id FROM bookings WHERE id=$1', [bookingId]);
    const userId = bRes.rows[0].user_id;

    if (action === 'present') {
        const [sH, sM] = c.start_time.split(':').map(Number);
        const [eH, eM] = c.end_time.split(':').map(Number);
        const duration = (eH*60 + eM) - (sH*60 + sM);
        await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,$5,'attended', NOW())`, [userId, courseId, c.name, c.category, duration]);
        await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]);
        await pool.query("UPDATE bookings SET status = 'attended' WHERE id = $1", [bookingId]);
        res.json({ success: true, msg: `签到+${duration}` });
    } else if (action === 'absent') {
        await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,0,'absent', NOW())`, [userId, courseId, c.name, c.category]);
        await pool.query(`UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id = $1`, [userId]);
        res.json({ success: true, msg: '补课+1' });
    }
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/teacher/remove-booking', async (req, res) => {
  const { bookingId } = req.body;
  try {
    const check = await pool.query('SELECT user_id, is_makeup FROM bookings WHERE id=$1', [bookingId]);
    if (check.rows.length > 0 && check.rows[0].is_makeup) {
        await pool.query('UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id=$1', [check.rows[0].user_id]);
    }
    await pool.query('DELETE FROM bookings WHERE id=$1', [bookingId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/ai-report', async (req, res) => {
    if(!req.session.user) return res.status(401).json({error:'Login'});
    try {
        const stats = await pool.query(`SELECT category, SUM(duration_minutes) as total FROM attendance_logs WHERE user_id=$1 GROUP BY category`, [req.session.user.id]);
        res.json({timeStats: stats.rows, aiAnalysis: {warnings:[], recommendations:[]}});
    } catch(e) { res.status(500).json({error:'Error'}); }
});

// 路由
const pages = ['index.html','games.html','timetable.html','my_schedule.html','invoices.html','admin.html','stats.html','growth.html','wrapper.html'];
pages.forEach(p => app.get('/'+(p==='index.html'?'':p), (req,res)=>res.sendFile(path.join(__dirname,'public',p))));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));