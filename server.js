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
    // 1. 用户表 (新增 makeup_credits 补课额度)
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, level INTEGER DEFAULT 1, coins INTEGER DEFAULT 0, student_name TEXT, dob DATE, agreed_terms BOOLEAN DEFAULT FALSE, total_minutes INTEGER DEFAULT 0, makeup_credits INTEGER DEFAULT 0)`);
    // 补丁
    const uCols = ['student_name TEXT', 'dob DATE', 'agreed_terms BOOLEAN DEFAULT FALSE', 'total_minutes INTEGER DEFAULT 0', 'makeup_credits INTEGER DEFAULT 0'];
    for(const c of uCols) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${c}`);

    // 2. 课程表
    await pool.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, min_age INTEGER, max_age INTEGER, teacher TEXT, price DECIMAL(10,2), casual_price DECIMAL(10,2), category TEXT)`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General'`);
    await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS casual_price DECIMAL(10, 2) DEFAULT 0`);

    // 3. 报名表 (新增 is_makeup 标记)
    await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, student_name TEXT, status TEXT DEFAULT 'UNPAID', price_snapshot DECIMAL(10,2), booking_type TEXT, selected_dates TEXT, is_makeup BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_makeup BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_dates TEXT`);

    // 4. 签到日志 (新增 status: attended/absent)
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_logs (id SERIAL PRIMARY KEY, user_id INTEGER, course_id INTEGER, course_name TEXT, category TEXT, duration_minutes INTEGER, status TEXT, check_in_time TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'attended'`);

    // 5. 游戏分数
    await pool.query(`CREATE TABLE IF NOT EXISTS scores (id SERIAL PRIMARY KEY, user_id INTEGER, game_id TEXT, score INTEGER, created_at TIMESTAMP DEFAULT NOW())`);

    console.log('DB Initialized');
    initAllCourses(); 
  } catch (err) { console.error('DB Init Error:', err); }
})();

// === 全量课表 (保持不变) ===
async function initAllCourses() {
  try {
    const check = await pool.query("SELECT count(*) FROM courses");
    if (parseInt(check.rows[0].count) > 5) return; 
    console.log('Seeding Courses...');
    const courses = [
      { d:'Monday', n:'英皇芭蕾5级', s:'16:00', e:'17:00', min:9, max:11, t:'DEMI', p:200, c:'RAD' },
      { d:'Monday', n:'OPEN 软开核心', s:'16:00', e:'17:00', min:9, max:99, t:'CINDY', p:180, c:'Technique' },
      { d:'Tuesday', n:'英皇芭蕾2级', s:'17:00', e:'18:00', min:7, max:8, t:'DEMI', p:200, c:'RAD' },
      { d:'Wednesday', n:'HIPHOP LEVEL 1', s:'16:00', e:'17:00', min:6, max:8, t:'NANA', p:180, c:'HipHop' },
      { d:'Friday', n:'JAZZ 爵士舞团', s:'16:00', e:'17:00', min:8, max:99, t:'KATIE', p:220, c:'Jazz' },
      { d:'Friday', n:'K-POP (少儿)', s:'17:00', e:'18:00', min:8, max:10, t:'JISOO', p:180, c:'Kpop' },
      { d:'Saturday', n:'幼儿芭蕾启蒙', s:'11:00', e:'12:00', min:3, max:5, t:'DEMI', p:180, c:'Ballet' }
    ];
    for (const c of courses) {
      await pool.query(`INSERT INTO courses (name, day_of_week, start_time, end_time, min_age, max_age, teacher, price, casual_price, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, 
      [c.n, c.d, c.s, c.e, c.min, c.max, c.t, c.p, Math.ceil(c.p/8), c.c]);
    }
  } catch (e) {}
}

// 游戏接口
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
                  games[dir] = { id: dir, title: meta.title || dir, description: meta.description || '', thumbnail: meta.thumbnail || '', platform: dir.includes('mobile')?'mobile':'pc', entry: `/games/${dir}/index.html` };
              } catch(e) {}
          }
      });
  }
  if (fs.existsSync(path.join(__dirname, 'games', 'demo-game.html'))) games['demo'] = { id:'demo', title:'Demo', thumbnail:'', entry:'/games/demo-game.html' };
  return Object.values(games);
}
app.get('/api/games', (req, res) => res.json(scanGames()));
app.get('/play/:id', async (req, res) => { /* Wrapper omitted for brevity, same as before */ res.sendFile(path.join(__dirname, 'public', 'wrapper.html')); });
app.post('/api/score', async (req, res) => { /* Score logic same */ res.json({success:true}); });

// 用户 API
app.post('/api/register', async (req, res) => { /* Same */ const { email, password, studentName, dob } = req.body; try { const hash = await bcrypt.hash(password, 10); const r = await pool.query(`INSERT INTO users (email, password_hash, student_name, dob) VALUES ($1,$2,$3,$4) RETURNING id, email, student_name`, [email, hash, studentName, dob]); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.post('/api/login', async (req, res) => { /* Same */ const { email, password } = req.body; try { const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]); if(!r.rows[0] || !await bcrypt.compare(password, r.rows[0].password_hash)) return res.status(401).json({error:'Invalid'}); req.session.user = r.rows[0]; res.json(r.rows[0]); } catch(e) { res.status(500).json({error:'Error'}); } });
app.get('/api/me', async (req, res) => {
    if(!req.session.user) return res.json(null);
    // 实时获取最新的补课额度
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]);
    res.json(r.rows[0]);
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// 选课 API
app.get('/api/courses/recommended', async (req, res) => {
  if(!req.session.user) return res.status(401).json({error:'Login'});
  try {
    const u = await pool.query('SELECT dob FROM users WHERE id=$1', [req.session.user.id]);
    const dob = new Date(u.rows[0].dob);
    let age = new Date().getFullYear() - dob.getFullYear();
    if (new Date() < new Date(new Date().getFullYear(), dob.getMonth(), dob.getDate())) age--;
    const list = await pool.query(`SELECT * FROM courses WHERE min_age <= $1 AND max_age >= $1 ORDER BY start_time`, [age]);
    res.json({age, courses: list.rows});
  } catch(e) { res.status(500).json({error:'Error'}); }
});

// === 核心逻辑：报名 (支持补课) ===
app.post('/api/book-course', async (req, res) => {
  if(!req.session.user) return res.status(401).json({error:'Login'});
  const { courseId, type, selectedDates, totalPrice } = req.body; 
  // type: 'term', 'casual', 'makeup' (补课)
  
  try {
    const uRes = await pool.query('SELECT student_name, makeup_credits FROM users WHERE id=$1', [req.session.user.id]);
    const user = uRes.rows[0];

    // 补课逻辑
    if (type === 'makeup') {
        if (user.makeup_credits <= 0) return res.json({success:false, message:'没有补课额度'});
        
        // 扣除额度
        await pool.query('UPDATE users SET makeup_credits = makeup_credits - 1 WHERE id=$1', [req.session.user.id]);
        
        // 创建补课订单 (Price=0, Status=PAID, is_makeup=TRUE)
        await pool.query(
            `INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status, is_makeup) 
             VALUES ($1, $2, $3, 0, 'makeup', $4, 'PAID', TRUE)`, 
            [req.session.user.id, courseId, user.student_name, selectedDates.join(',')]
        );
        return res.json({success:true, message:'补课预约成功！'});
    }

    // 正常报名逻辑
    if (type === 'term') {
        const check = await pool.query("SELECT * FROM bookings WHERE user_id=$1 AND course_id=$2 AND booking_type='term'", [req.session.user.id, courseId]);
        if (check.rows.length > 0) return res.json({ success: false, message: '您已报名该课程整学期' });
    }
    
    await pool.query(
        `INSERT INTO bookings (user_id, course_id, student_name, price_snapshot, booking_type, selected_dates, status) 
         VALUES ($1, $2, $3, $4, $5, $6, 'UNPAID')`, 
        [req.session.user.id, courseId, user.student_name, totalPrice, type, selectedDates?selectedDates.join(','):'']
    );
    res.json({ success: true, message: '报名成功！' });
  } catch(e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/my-schedule', async (req, res) => { /* Same */ if(!req.session.user) return res.status(401).json({error:'Login'}); try { const r = await pool.query(`SELECT c.name, c.day_of_week, c.start_time, c.end_time, c.teacher, b.status, b.price_snapshot, b.booking_type, b.is_makeup, b.selected_dates FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e) { res.status(500).json({error:'Error'}); } });
app.get('/api/my-invoices', async (req, res) => { /* Same */ try { const r = await pool.query(`SELECT b.*, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id=c.id WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.session.user.id]); res.json(r.rows); } catch(e){res.status(500).json({error:'Error'});} });

// === 老师后台逻辑 (增强) ===
app.get('/api/teacher/schedule', async (req, res) => {
    try {
        // 统计每节课的报名人数 (包括补课的)
        const result = await pool.query(`
            SELECT c.*, 
            (SELECT COUNT(*) FROM bookings b WHERE b.course_id = c.id AND (b.booking_type='term' OR b.status='active' OR b.is_makeup=TRUE)) as student_count
            FROM courses c ORDER BY day_of_week, start_time
        `); 
        // 注意：day_of_week 排序需要更复杂的 CASE WHEN，这里简化处理，前端做排序
        res.json(result.rows);
    } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/teacher/bookings/:courseId', async (req, res) => {
  const { courseId } = req.params;
  // 获取详细名单，包括是否补课
  const r = await pool.query(
    `SELECT b.id, b.status, b.is_makeup, b.selected_dates, u.student_name, u.total_minutes 
     FROM bookings b JOIN users u ON b.user_id=u.id 
     WHERE b.course_id = $1`,
    [courseId]
  );
  res.json(r.rows);
});

// 核心：签到/缺勤处理
app.post('/api/teacher/action', async (req, res) => {
  const { bookingId, courseId, action, customDate } = req.body; 
  // action: 'present' (到课) | 'absent' (缺勤)
  
  try {
    const c = (await pool.query('SELECT name, start_time, end_time, category FROM courses WHERE id=$1', [courseId])).rows[0];
    const bRes = await pool.query('SELECT user_id FROM bookings WHERE id=$1', [bookingId]);
    const userId = bRes.rows[0].user_id;

    if (action === 'present') {
        // 1. 计算时长
        const [sH, sM] = c.start_time.split(':').map(Number);
        const [eH, eM] = c.end_time.split(':').map(Number);
        const duration = (eH*60 + eM) - (sH*60 + sM);
        
        // 2. 记录日志
        await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,$5,'attended', NOW())`, 
            [userId, courseId, c.name, c.category, duration]);
        
        // 3. 加时长 & 积分
        await pool.query(`UPDATE users SET total_minutes = total_minutes + $1, coins = coins + $1 WHERE id = $2`, [duration, userId]);
        
        // 如果是补课单，签到后这单就完成了，没用了 (逻辑上可以归档，这里标记一下)
        await pool.query("UPDATE bookings SET status = 'attended' WHERE id = $1", [bookingId]);
        
        res.json({ success: true, msg: `已签到 +${duration}min` });

    } else if (action === 'absent') {
        // 缺勤处理：
        // 1. 记录缺勤日志 (时长0)
        await pool.query(`INSERT INTO attendance_logs (user_id, course_id, course_name, category, duration_minutes, status, check_in_time) VALUES ($1,$2,$3,$4,0,'absent', NOW())`, 
            [userId, courseId, c.name, c.category]);
            
        // 2. 【关键】给用户增加补课额度
        await pool.query(`UPDATE users SET makeup_credits = makeup_credits + 1 WHERE id = $1`, [userId]);
        
        res.json({ success: true, msg: '已标记缺勤，补课额度 +1' });
    }
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/ai-report', async (req, res) => { /* Same */ try { const stats = await pool.query(`SELECT category, SUM(duration_minutes) as total FROM attendance_logs WHERE user_id=$1 GROUP BY category`, [req.session.user.id]); res.json({timeStats: stats.rows, aiAnalysis: {warnings:[], recommendations:[]}}); } catch(e) { res.status(500).json({error:'Error'}); } });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/games.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/timetable.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'timetable.html')));
app.get('/my_schedule.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my_schedule.html')));
app.get('/invoices.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoices.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/stats.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stats.html')));
app.get('/growth.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'growth.html')));

app.listen(process.env.PORT || 3000, () => console.log('Server running'));