const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
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
app.use('/games', express.static('games'));

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
        total_minutes INTEGER DEFAULT 0
      );
    `);
    // 补丁：确保字段存在
    const userCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0'];
    for (const col of userCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`);

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
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type TEXT DEFAULT 'term'`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_dates TEXT`);

    // 4. 签到日志表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        course_id INTEGER REFERENCES courses(id),
        course_name TEXT,
        category TEXT,
        duration_minutes INTEGER,
        check_in_time TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // 5. 游戏分数表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('Database initialized.');
    initAllCourses(); 

  } catch (err) {
    console.error('DB init error:', err.message);
  }
})();

// === 全量课表录入 (基于图片) ===
async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return; // 简单防重

    console.log('正在初始化全量课表...');
    
    const courses = [
      // === MONDAY ===
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心与技巧', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', p:180, c:'Technique' },
      { d:'Monday', n:'OPEN 芭蕾技巧与基础', s:'16:00', e:'17:00', min:5, max:8, t:'CARRIE', p:180, c:'Ballet' },
      { d:'Monday', n:'英皇芭蕾3级', s:'18:00', e:'19:00', min:9, max:99, t:'LIU', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 舞团班', s:'19:00', e:'20:00', min:12, max:99, t:'CINDY', p:220, c:'Performance' },

      // === TUESDAY ===
      { d:'Tuesday', n:'英皇芭蕾4级', s:'16:00', e:'17:00', min:9, max:10, t:'DEMI', p:200, c:'RAD' },
      { d:'Tuesday', n:'软开度/核心与技巧', s:'16:00', e:'17:00', min:7, max:8, t:'CINDY', p:180, c:'Technique' },
      { d:'Tuesday', n:'英皇芭蕾2级', s:'17:00', e:'18:00', min:7, max:8, t:'DEMI', p:200, c:'RAD' },
      { d:'Tuesday', n:'RAD INTERMEDIATE FOUNDATION', s:'18:00', e:'19:00', min:10, max:13, t:'DEMI', p:220, c:'RAD' },
      { d:'Tuesday', n:'OPEN 芭蕾足尖课', s:'19:00', e:'20:00', min:10, max:15, t:'TONIA', p:200, c:'Ballet' },

      // === WEDNESDAY ===
      { d:'Wednesday', n:'英皇芭蕾1级', s:'16:00', e:'17:00', min:7, max:99, t:'CARRIE', p:200, c:'RAD' },
      { d:'Wednesday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Wednesday', n:'HIPHOP LEVEL 2', s:'17:00', e:'18:00', min:9, max:15, t:'NANA', p:180, c:'HipHop' },
      { d:'Wednesday', n:'OPEN 现代舞基础', s:'18:00', e:'19:00', min:7, max:9, t:'ASA', p:180, c:'Contemporary' },

      // === THURSDAY ===
      { d:'Thursday', n:'基础软开与核心训练', s:'16:00', e:'17:00', min:5, max:6, t:'DEMI', p:180, c:'Technique' },
      { d:'Thursday', n:'DANCE TROUPE MUSICAL', s:'17:00', e:'18:00', min:4, max:6, t:'TARNIA', p:180, c:'Performance' },
      { d:'Thursday', n:'英皇芭蕾5级', s:'18:00', e:'19:00', min:9, max:10, t:'DEMI', p:200, c:'RAD' },
      { d:'Thursday', n:'HIPHOP 提高班', s:'18:30', e:'20:00', min:9, max:15, t:'NANA', p:220, c:'HipHop' },

      // === FRIDAY ===
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:220, c:'Jazz' },
      { d:'Friday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Friday', n:'K-POP 韩国流行舞', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:180, c:'Kpop' },
      { d:'Friday', n:'K-POP 韩国流行舞', s:'18:00', e:'19:30', min:11, max:16, t:'JISOO', p:220, c:'Kpop' },

      // === SATURDAY ===
      { d:'Saturday', n:'英皇芭蕾 PRIMARY', s:'09:30', e:'11:00', min:5, max:6, t:'CARRIE', p:220, c:'RAD' },
      { d:'Saturday', n:'幼儿芭蕾启蒙班', s:'11:00', e:'12:00', min:3, max:5, t:'DEMI', p:180, c:'Ballet' },
      { d:'Saturday', n:'K-POP', s:'11:00', e:'12:30', min:11, max:16, t:'HAZEL', p:220, c:'Kpop' },
      { d:'Saturday', n:'NZAMD 爵士考级 L1', s:'12:00', e:'13:00', min:5, max:6, t:'KATIE', p:200, c:'Jazz' },
      { d:'Saturday', n:'PBT 进阶芭蕾技巧', s:'13:00', e:'14:00', min:7, max:8, t:'CARRIE', p:180, c:'Technique' },

      // === SUNDAY ===
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
    console.log('✅ 2026 全量课表初始化完成');
  } catch (e) { console.error(e); }
}

// === API: 游戏功能 (修复：恢复文件夹扫描) ===
function scanGames() {
  const games = {};
  const gamesDir = path.join(__dirname, 'games');
  if (fs.existsSync(gamesDir)) {
      const dirs = fs.readdirSync(gamesDir);
      dirs.forEach(dir => {
          const jsonPath = path.join(gamesDir, dir, 'game.json');
          if (fs.existsSync(jsonPath)) {
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
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) {
      games['demo'] = { id:'demo', title:'Demo Game', description:'Test', thumbnail:'', platform:'both', entry:'/games/demo-game.html' };
  }
  return Object.values(games);
}

app.get('/api/games', (req, res) => res.json(scanGames()));

app.get('/play/:id', async (req, res) => {
  const gameId = req.params.id;
  const games = scanGames();
  const game = games.find(g => g.id === gameId);
  if (!game) return res.status(404).send('Game not found');

  if (!req.session.user) {
    return res.redirect(`/?redirect=${encodeURIComponent('/play/' + gameId)}`);
  }

  const wrapperUrl = `/wrapper.html?src=${encodeURIComponent(game.entry)}`;
  let scores = [];
  try {
    const r = await pool.query('SELECT score, created_at FROM scores WHERE user_id = $1 AND game_id = $2 ORDER BY score DESC LIMIT 10', [req.session.user.id, gameId]);
    scores = r.rows;
  } catch (e) {}

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${game.title}</title><style>body{font-family:Arial;margin:0;background:#f4f4f4}.header{background:#ff6b35;color:#fff;padding:1rem;text-align:center;position:relative}.back{position:absolute;left:1rem;top:1rem;color:#fff;text-decoration:none}.container{max-width:1200px;margin:auto;padding:1rem}iframe{width:100%;height:75vh;border:none;border-radius:8px}.scores{background:#fff;padding:1.5rem;margin-top:1rem;border-radius:8px}</style></head><body><div class="header"><a href="/games.html" class="back">返回</a><h1>${game.title}</h1></div><div class="container"><iframe src="${wrapperUrl}" allowfullscreen></iframe><div class="scores"><h3>你的历史分数</h3>${scores.length?scores.map(s=>`<div><strong>${s.score}</strong> - ${new Date(s.created_at).toLocaleString()}</div>`).join(''):'<p>暂无记录</p>'}</div></div></body></html>`);
});

app.post('/api/score', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  const { gameId, score } = req.body;
  try {
    await pool.query('INSERT INTO scores (user_id, game_id, score) VALUES ($1,$2,$3)', [req.session.user.id, gameId, score]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Save failed' }); }
});

// === API: 用户管理 ===
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
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// === API: 选课与报名 ===
app.get('/api/courses/recommended', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  try {
    const userRes = await pool.query('SELECT dob FROM users WHERE id = $1', [req.session.user.id]);
    if (!userRes.rows[0].dob) return res.status(400).json({ error: '请先完善生日信息' });
    
    const dob = new Date(userRes.rows[0].dob);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;

    const coursesRes = await pool.query(
      `SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, 
      [age]
    );
    res.json({ age: age, courses: coursesRes.rows });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/book-course', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  const { courseId, type, selectedDates, totalPrice } = req.body; 
  try {
    if (type === 'term') {
        const check = await pool.query("SELECT * FROM bookings WHERE user_id = $1 AND course_id = $2 AND booking_type = 'term'", [req.session.user.id, courseId]);
        if (check.rows.length > 0) return res.json({ success: false, message: '您已报名该课程整学期' });
    }
    const uRes = await pool.query('SELECT student_name FROM users WHERE id = $1', [req.session.user.id]);
    await pool.query(
        `INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status) 
         VALUES ($1, $2, $3, $4, $5, $6, 'UNPAID')`, 
        [req.session.user.id, courseId, uRes.rows[0].student_name, totalPrice, type, selectedDates?selectedDates.join(','):'']
    );
    res.json({ success: true, message: '报名成功！' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/my-invoices', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '未登录' });
    try {
        const result = await pool.query(`
            SELECT b.*, c.name as course_name, c.day_of_week, c.start_time 
            FROM bookings b JOIN courses c ON b.course_id = c.id
            WHERE b.user_id = $1 ORDER BY b.created_at DESC`, [req.session.user.id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json({error: 'Error'}); }
});

app.get('/api/my-schedule', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Login required' });
    try {
        const result = await pool.query(`
            SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot 
            FROM bookings b
            JOIN courses c ON b.course_id = c.id
            WHERE b.user_id = $1
            ORDER BY 
                CASE WHEN c.day_of_week='Monday' THEN 1 WHEN c.day_of_week='Tuesday' THEN 2 WHEN c.day_of_week='Wednesday' THEN 3 WHEN c.day_of_week='Thursday' THEN 4 WHEN c.day_of_week='Friday' THEN 5 WHEN c.day_of_week='Saturday' THEN 6 ELSE 7 END,
                c.start_time
        `, [req.session.user.id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json({error: 'Error'}); }
});

// === API: 老师端 & 统计 ===
app.get('/api/teacher/courses', async (req, res) => {
  const result = await pool.query('SELECT * FROM courses ORDER BY day_of_week, start_time');
  res.json(result.rows);
});

app.get('/api/teacher/bookings/:courseId', async (req, res) => {
  const { courseId } = req.params;
  const result = await pool.query(
    `SELECT b.id, b.status, u.student_name, u.total_minutes FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.course_id = $1`,
    [courseId]
  );
  res.json(result.rows);
});

app.post('/api/teacher/check-in', async (req, res) => {
  const { bookingId, courseId } = req.body;
  try {
    const cRes = await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id = $1', [courseId]);
    const c = cRes.rows[0];
    const [sH, sM] = c.start_time.split(':').map(Number);
    const [eH, eM] = c.end_time.split(':').map(Number);
    const duration = (eH * 60 + eM) - (sH * 60 + sM); 
    
    const bRes = await pool.query('SELECT user_id FROM bookings WHERE id = $1', [bookingId]);
    const userId = bRes.rows[0].user_id;

    await pool.query(
        `INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, courseId, c.name, c.category, duration]
    );

    await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]);
    await pool.query("UPDATE bookings SET status = 'attended' WHERE id = $1", [bookingId]);

    res.json({ success: true, added_minutes: duration });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// 新增：老师课表加强版 (带人数统计)
app.get('/api/teacher/schedule', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, (SELECT COUNT(*) FROM bookings b WHERE b.course_id = c.id) as student_count
            FROM courses c 
            ORDER BY 
                CASE WHEN day_of_week = 'Monday' THEN 1 WHEN day_of_week = 'Tuesday' THEN 2 WHEN day_of_week = 'Wednesday' THEN 3 WHEN day_of_week = 'Thursday' THEN 4 WHEN day_of_week = 'Friday' THEN 5 WHEN day_of_week = 'Saturday' THEN 6 ELSE 7 END, 
                start_time
        `);
        res.json(result.rows);
    } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/ai-report', async (req, res) => {
    if(!req.session.user) return res.status(401).json({error:'Login'});
    try {
        const stats = await pool.query(`SELECT category, SUM(duration_minutes) as total FROM attendance_logs WHERE user_id=$1 GROUP BY category`, [req.session.user.id]);
        res.json({timeStats: stats.rows, aiAnalysis: {warnings:[], recommendations:[]}});
    } catch(e) { res.status(500).json({error:'Error'}); }
});

// 页面路由
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/timetable.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'timetable.html')));
app.get('/my_schedule.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my_schedule.html')));
app.get('/invoices.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoices.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/stats.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stats.html'))); // 修复：把 growth.html 改名为 stats.html 保持统一，或者反之。这里假设是 stats.html
// 注意：上面的前端代码里用了 growth.html，这里做个映射
app.get('/growth.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'growth.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));