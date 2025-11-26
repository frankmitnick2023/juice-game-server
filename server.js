const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session); // ★★★ 关键修复：引入 PG Session ★★★
const multer = require('multer');
const { createHash } = require('crypto');

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Multer Config ---
const upload = multer({ 
    storage: multer.diskStorage({ 
        destination: './public/uploads/', 
        filename: (req, file, cb) => cb(null, `${req.session.userId || 'admin'}-${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 5 * 1024 * 1024 } 
}).fields([
    { name: 'mainImage', maxCount: 1 }, 
    { name: 'extraImages', maxCount: 5 }, 
    { name: 'trophyImage', maxCount: 1 } 
]);

app.use(bodyParser.json());
app.use(express.static('public'));

// --- ★★★ 核心修复：Session 持久化 (解决掉线问题) ★★★ ---
app.use(session({
  store: new pgSession({
    pool: pool,                // 使用现有的数据库连接
    tableName: 'session_store', // 在数据库里建一张表专门存登录状态
    createTableIfMissing: true // 如果表不存在，自动创建
  }),
  secret: process.env.SESSION_SECRET || 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 记住登录状态 30 天
}));

// --- Helpers ---
function hashPassword(password) { return createHash('sha256').update(password).digest('hex'); }
function calculateAge(dob) { if (!dob) return 7; const diff = Date.now() - new Date(dob).getTime(); return Math.abs(new Date(diff).getUTCFullYear() - 1970); }
function requireLogin(req, res, next) { if (req.session.userId) { next(); } else { if (req.path.startsWith('/admin')) { return res.redirect('/'); } res.status(401).json({ error: 'Unauthorized' }); } }
function requireAdmin(req, res, next) { if (req.session.userId === 1) { next(); } else { res.status(403).json({ error: 'Forbidden' }); } }

// --- DB Setup & Seeding ---
async function initDB() {
  const client = await pool.connect();
  try {
    // Tables
    await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password TEXT, student_name TEXT, dob DATE, level INTEGER DEFAULT 1, makeup_credits INTEGER DEFAULT 0, avatar_config TEXT, is_admin BOOLEAN DEFAULT FALSE)`);
    await client.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, teacher TEXT, price REAL, casual_price REAL DEFAULT 25.0, classroom TEXT, age_group TEXT)`);
    await client.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_id INTEGER REFERENCES courses(id), type TEXT, dates TEXT, total_price REAL, status TEXT DEFAULT 'UNPAID', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS trophies (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), image_path TEXT, extra_images TEXT DEFAULT '[]', source_name TEXT, trophy_type TEXT, review_status TEXT DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, title TEXT, thumbnail TEXT, path TEXT)`);
    // Check-In System Tables
    await client.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_id INTEGER REFERENCES courses(id), lesson_date DATE, check_in_time TIMESTAMP, is_excused_absence BOOLEAN DEFAULT FALSE, was_present BOOLEAN DEFAULT FALSE, experience_gained_hrs REAL DEFAULT 0.0, make_up_credit_granted_id INTEGER, UNIQUE (user_id, course_id, lesson_date))`);
    await client.query(`CREATE TABLE IF NOT EXISTS make_up_credits (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), granted_date DATE, expiry_date DATE, is_used BOOLEAN DEFAULT FALSE, used_for_booking_id INTEGER, related_attendance_id INTEGER REFERENCES attendance(id))`);
    await client.query(`CREATE TABLE IF NOT EXISTS course_progress (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_category TEXT, cumulative_hours REAL DEFAULT 0.0, UNIQUE (user_id, course_category))`);

    // Admin
    const adminExists = await client.query("SELECT id FROM users WHERE is_admin = TRUE");
    if (adminExists.rowCount === 0) {
      const hashedPassword = hashPassword('admin123');
      await client.query("INSERT INTO users (email, password, student_name, is_admin) VALUES ('admin@admin.com', $1, 'Admin User', TRUE)", [hashedPassword]);
    }

    // Games Seeding
    const { rows: gameRows } = await client.query("SELECT count(*) as count FROM games");
    if (parseInt(gameRows[0].count) === 0) {
        const games = [
            {id: 'ballet-pro', title: 'Ballet Pro', thumb: 'thumbnail.jpg', path: 'ballet-pro'},
            {id: 'demo-game', title: 'Demo Game', thumb: 'thumbnail.jpg', path: 'demo-game'},
            {id: 'juice-mobile', title: 'Juice Maker (Mobile)', thumb: 'thumbnail.jpg', path: 'juice-maker-mobile'},
            {id: 'juice-pc', title: 'Juice Maker (PC)', thumb: 'thumbnail.jpg', path: 'juice-maker-PC'},
            {id: 'ready-action', title: 'Ready!! Action!!', thumb: 'thumbnail.jpg', path: 'Ready!!Action!!'},
            {id: 'rhythm', title: 'Rhythm Challenger', thumb: 'thumbnail.jpg', path: 'rhythm-challenger'},
            {id: 'rhythm-train', title: 'Rhythm Training', thumb: 'thumbnail.jpg', path: 'rhythm-challenger-trainning'} 
        ];
        for(const g of games) {
            await client.query("INSERT INTO games (id, title, thumbnail, path) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING", [g.id, g.title, g.thumb, g.path]);
        }
    }

    console.log('DB initialized.');
  } catch (err) { console.error('Error initializing DB:', err); } finally { client.release(); }
}
initDB();

// --- Experience Logic ---
async function accumulateExperience(userId, courseName) {
    const client = await pool.connect();
    try {
        let category = 'Other';
        if (courseName.includes('Ballet') || courseName.includes('RAD')) category = 'RAD Ballet';
        else if (courseName.includes('Jazz') || courseName.includes('NZAMD')) category = 'NZAMD Jazz';
        await client.query(`INSERT INTO course_progress (user_id, course_category, cumulative_hours) VALUES ($1, $2, $3) ON CONFLICT (user_id, course_category) DO UPDATE SET cumulative_hours = course_progress.cumulative_hours + $3`, [userId, category, 1.0]);
    } catch (e) { console.error(e); } finally { client.release(); }
}

// --- AUTH ---
app.post('/api/register', async (req, res) => {
  try {
    const hashedPassword = hashPassword(req.body.password);
    const r = await pool.query("INSERT INTO users (email, password, student_name, dob, avatar_config) VALUES ($1, $2, $3, $4, $5) RETURNING id", [req.body.email, hashedPassword, req.body.studentName, req.body.dob, JSON.stringify({gender:'girl',ageGroup:'junior',outfit:'uniform'})]);
    req.session.userId = r.rows[0].id; res.json({ success: true, id: r.rows[0].id });
  } catch (e) { res.status(400).json({ error: 'Email exists' }); }
});
// --- 兼容版登录接口 (同时支持明文和哈希) ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    // 1. 先尝试直接匹配明文密码 (兼容你现在的旧数据)
    let result = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]);
    
    // 2. 如果明文没找到，再尝试匹配哈希密码 (兼容新注册用户)
    if (result.rows.length === 0) {
        const hashedPassword = hashPassword(password);
        result = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, hashedPassword]);
    }

    if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    req.session.userId = user.id;
    // 兼容没有 is_admin 字段的情况
    req.session.isAdmin = user.is_admin || false; 
    
    res.json({ success: true, user: { name: user.student_name, isAdmin: req.session.isAdmin } });
  } catch (e) {
    console.error(e); // 打印错误以便调试
    res.status(500).json({ error: 'DB Error' });
  }
});
app.get('/api/me', requireLogin, async (req, res) => {
  try { const r = await pool.query("SELECT id, email, student_name, dob, level, makeup_credits, avatar_config FROM users WHERE id = $1", [req.session.userId]); if(r.rows.length > 0) { const u = r.rows[0]; if(u.avatar_config) u.avatar_config = JSON.parse(u.avatar_config); res.json(u); } else { res.status(404).json({error: 'Not found'}); } } catch(e) { res.status(500).json({error: e.message}); }
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// --- USER FEATURES ---
app.get('/play/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/api/games', async (req, res) => { try { const r = await pool.query("SELECT * FROM games"); res.json(r.rows); } catch (e) { res.status(500).json([]); } });
app.get('/api/public-schedule', async (req, res) => { try { const r = await pool.query("SELECT name, day_of_week, start_time, end_time, classroom FROM courses"); res.json(r.rows); } catch(e) { res.status(500).json([]); } });

app.get('/api/courses/recommended', async (req, res) => {
  try {
    let age = 7; if (req.session.userId) { const uRes = await pool.query("SELECT dob FROM users WHERE id = $1", [req.session.userId]); if (uRes.rows.length > 0) age = calculateAge(uRes.rows[0].dob); }
    const r = await pool.query("SELECT * FROM courses");
    let list = r.rows.filter(c => {
        if(!c.age_group) return true; if(c.age_group.toLowerCase().includes('beginner')) return true;
        if(c.age_group.includes('-')) { const p = c.age_group.split('-'); return age >= parseFloat(p[0]) && age <= parseFloat(p[1]); }
        if(c.age_group.includes('+')) return age >= parseFloat(c.age_group);
        if(!isNaN(parseFloat(c.age_group))) return age === parseFloat(c.age_group); return true;
    });
    res.json({ age, courses: list });
  } catch(e) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/my-bookings', requireLogin, async (req, res) => { try { const r = await pool.query("SELECT course_id, type, dates FROM bookings WHERE user_id = $1", [req.session.userId]); res.json(r.rows.map(row => ({...row, dates: row.dates?JSON.parse(row.dates):[]}))); } catch(e) { res.json([]); } });
app.post('/api/book-course', requireLogin, async (req, res) => {
  try {
    const {courseId, type, selectedDates, totalPrice} = req.body;
    const check = await pool.query("SELECT * FROM bookings WHERE user_id=$1 AND course_id=$2 AND type='term'", [req.session.userId, courseId]);
    if(check.rows.length) return res.status(400).json({success:false, message:'Already Joined'});
    await pool.query("INSERT INTO bookings (user_id, course_id, type, dates, total_price) VALUES ($1, $2, $3, $4, $5)", [req.session.userId, courseId, type, JSON.stringify(selectedDates||[]), totalPrice]);
    res.json({success:true});
  } catch(e) { res.status(500).json({success:false}); }
});
app.get('/api/my-schedule', requireLogin, async (req, res) => { try { const sql = `SELECT b.id, b.type as booking_type, b.status, c.name, c.day_of_week, c.start_time, c.teacher, c.classroom FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1`; const r = await pool.query(sql, [req.session.userId]); res.json(r.rows); } catch(e) { res.json([]); } });
app.get('/api/my-invoices', requireLogin, async(req,res)=>{ try{ const r=await pool.query("SELECT b.id, b.total_price as price_snapshot, b.status, b.created_at, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1 ORDER BY b.created_at DESC",[req.session.userId]); res.json(r.rows); }catch(e){res.json([])} });
app.post('/api/upload-trophy-v2', requireLogin, upload, async(req,res)=>{ try{ const main=req.files['mainImage']?'/uploads/'+req.files['mainImage'][0].filename:null; const extras=req.files['extraImages']?req.files['extraImages'].map(f=>'/uploads/'+f.filename):[]; await pool.query("INSERT INTO trophies (user_id, image_path, extra_images, source_name) VALUES ($1,$2,$3,$4)",[req.session.userId, main, JSON.stringify(extras), 'Pending']); res.json({success:true}); }catch(e){res.status(500).json({success:false})} });
app.get('/api/my-trophies', requireLogin, async(req,res)=>{ try{ const r=await pool.query("SELECT * FROM trophies WHERE user_id=$1 ORDER BY created_at DESC",[req.session.userId]); res.json(r.rows); }catch(e){res.json([])} });
app.post('/api/save-avatar', requireLogin, async(req,res)=>{ try{ await pool.query("UPDATE users SET avatar_config=$1 WHERE id=$2",[JSON.stringify(req.body.config), req.session.userId]); res.json({success:true}); }catch(e){res.status(500).json({error:'Error'})} });

// --- ADMIN API (FULL) ---
app.post('/api/admin/courses', requireAdmin, async(req,res)=>{ try{ await pool.query("INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1,$2,$3,$4,$5,$6,25,$7,$8)", [req.body.name, req.body.day, req.body.start, req.body.end, req.body.teacher, 230, req.body.classroom, req.body.age]); res.json({success:true}); }catch(e){res.status(500).json({error:e.message})} });
app.delete('/api/admin/courses/:id', requireAdmin, async(req,res)=>{ try{ await pool.query("DELETE FROM courses WHERE id=$1",[req.params.id]); res.json({success:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/admin/all-courses', requireAdmin, async(req,res)=>{ try{ const r=await pool.query("SELECT * FROM courses ORDER BY day_of_week, start_time"); res.json(r.rows); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/admin/trophies/pending', requireAdmin, async(req,res)=>{ try{ const r=await pool.query("SELECT t.*, u.student_name FROM trophies t JOIN users u ON t.user_id=u.id WHERE t.status='PENDING'"); const d=r.rows.map(i=>({...i, extra_images:i.extra_images?JSON.parse(i.extra_images):[]})); res.json(d); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/admin/trophies/approve', requireAdmin, async(req,res)=>{ try{ if(req.body.action==='reject') await pool.query("UPDATE trophies SET status='REJECTED' WHERE id=$1",[req.body.trophyId]); else await pool.query("UPDATE trophies SET status='APPROVED', trophy_type=$2, source_name=$3 WHERE id=$1",[req.body.trophyId, req.body.type, req.body.sourceName]); res.json({success:true}); }catch(e){res.status(500).json({error:e.message})} });
// Invoices
app.get('/api/admin/invoices', requireAdmin, async (req, res) => { try { const sql = `SELECT b.id, b.total_price, b.status, b.created_at, u.student_name, c.name as course_name, c.day_of_week, c.start_time, c.classroom, c.age_group FROM bookings b JOIN users u ON b.user_id = u.id JOIN courses c ON b.course_id = c.id ORDER BY b.created_at DESC`; const result = await pool.query(sql); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/admin/invoices/update-status', requireAdmin, async (req, res) => { try { await pool.query("UPDATE bookings SET status = $1 WHERE id = $2", [req.body.newStatus, req.body.bookingId]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
// Check In
app.get('/api/admin/check-in/weekly-schedule', requireAdmin, async (req, res) => { try { const result = await pool.query("SELECT id, name, day_of_week, start_time, end_time, teacher, classroom FROM courses ORDER BY day_of_week, start_time"); const schedule = {}; result.rows.forEach(c => { if (!schedule[c.day_of_week]) schedule[c.day_of_week] = []; schedule[c.day_of_week].push(c); }); res.json(schedule); } catch (e) { res.status(500).json({ success: false }); } });
app.get('/api/admin/check-in/class-list/:courseId', requireAdmin, async (req, res) => { try { const enrolledSql = `SELECT u.id AS user_id, u.student_name, b.status AS payment_status, 'ENROLLED' AS booking_type FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.course_id = $1 AND b.status != 'CANCELLED' AND b.type = 'term'`; const enrolled = await pool.query(enrolledSql, [req.params.courseId]); res.json(enrolled.rows); } catch (e) { res.status(500).json({ success: false }); } });
app.post('/api/admin/check-in/submit-attendance', requireAdmin, async (req, res) => { const { userId, courseId, lessonDate, status, courseName } = req.body; const client = await pool.connect(); try { await client.query('BEGIN'); let exp=0.0, exc=false, pres=false; if(status==='PRESENT'){pres=true;exp=1.0;await accumulateExperience(userId,courseName);} else if(status==='ABSENT_EXCUSED'){exc=true;await client.query(`INSERT INTO make_up_credits (user_id, granted_date, expiry_date) VALUES ($1,$2,$3)`,[userId,lessonDate,'2026-04-12']);} await client.query(`INSERT INTO attendance (user_id,course_id,lesson_date,is_excused_absence,was_present,experience_gained_hrs) VALUES ($1,$2,$3,$4,$5,$6)`,[userId,courseId,lessonDate,exc,pres,exp]); await client.query('COMMIT'); res.json({success:true}); } catch(e){ await client.query('ROLLBACK'); res.status(500).json({success:false}); } finally{client.release();} });

// --- Static ---
app.get('/admin.html', (req, res) => { if (req.session.userId === 1) res.sendFile(path.join(__dirname, 'public', 'admin.html')); else res.redirect('/'); });
const pages = ['games.html', 'timetable.html', 'my_schedule.html', 'invoices.html', 'growth.html', 'avatar_editor.html', 'rooms.html'];
pages.forEach(p => app.get(`/${p}`, (req, res) => req.session.userId ? res.sendFile(path.join(__dirname, 'public', p)) : res.redirect('/')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));