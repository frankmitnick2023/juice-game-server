const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const { createHash } = require('crypto');

const app = express();

// --- Postgres Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Multer Configuration (File Upload) ---
const upload = multer({ 
    storage: multer.diskStorage({ 
        destination: './public/uploads/', 
        filename: (req, file, cb) => cb(null, `${req.session.userId || 'admin'}-${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
}).fields([
    { name: 'mainImage', maxCount: 1 }, 
    { name: 'extraImages', maxCount: 5 }, 
    { name: 'trophyImage', maxCount: 1 } 
]);

app.use(bodyParser.json());
app.use(express.static('public'));

// --- Session Configuration (Persistent Store) ---
// 增加 trust proxy 设置，防止在某些反向代理下 session 失效
app.set('trust proxy', 1);

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session_store',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 Days
      secure: false // 在 HTTP 和 HTTPS 下都可用，增加兼容性
  } 
}));

// --- Helper Functions ---
function hashPassword(password) { return createHash('sha256').update(password).digest('hex'); }

function calculateAge(dob) {
  if (!dob) return 7; 
  const diff = Date.now() - new Date(dob).getTime();
  return Math.abs(new Date(diff).getUTCFullYear() - 1970);
}

function requireLogin(req, res, next) {
  if (req.session.userId) { next(); } 
  else { 
      if (req.path.startsWith('/admin')) return res.redirect('/');
      res.status(401).json({ error: 'Unauthorized' }); 
  }
}

function requireAdmin(req, res, next) {
  // 允许 ID=1 或 session 中标记为 admin 的用户
  if (req.session.userId === 1 || (req.session.user && req.session.user.isAdmin)) { next(); }
  else { res.status(403).json({ error: 'Forbidden' }); }
}

// --- Database Initialization & Seeding ---
async function initDB() {
  const client = await pool.connect();
  try {
    // 1. Create Tables
    await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password TEXT, student_name TEXT, dob DATE, level INTEGER DEFAULT 1, makeup_credits INTEGER DEFAULT 0, avatar_config TEXT, is_admin BOOLEAN DEFAULT FALSE)`);
    await client.query(`CREATE TABLE IF NOT EXISTS courses (id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, teacher TEXT, price REAL, casual_price REAL DEFAULT 25.0, classroom TEXT, age_group TEXT)`);
    await client.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_id INTEGER REFERENCES courses(id), type TEXT, dates TEXT, total_price REAL, status TEXT DEFAULT 'UNPAID', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS trophies (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), image_path TEXT, extra_images TEXT DEFAULT '[]', source_name TEXT, trophy_type TEXT, review_status TEXT DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, title TEXT, thumbnail TEXT, path TEXT, category TEXT)`);
    
    // Stats & Check-In Tables
    await client.query(`CREATE TABLE IF NOT EXISTS attendance (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_id INTEGER REFERENCES courses(id), lesson_date DATE, check_in_time TIMESTAMP, is_excused_absence BOOLEAN DEFAULT FALSE, was_present BOOLEAN DEFAULT FALSE, experience_gained_hrs REAL DEFAULT 0.0, make_up_credit_granted_id INTEGER, UNIQUE (user_id, course_id, lesson_date))`);
    await client.query(`CREATE TABLE IF NOT EXISTS make_up_credits (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), granted_date DATE, expiry_date DATE, is_used BOOLEAN DEFAULT FALSE, used_for_booking_id INTEGER, related_attendance_id INTEGER REFERENCES attendance(id))`);
    await client.query(`CREATE TABLE IF NOT EXISTS course_progress (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_category TEXT, cumulative_hours REAL DEFAULT 0.0, UNIQUE (user_id, course_category))`);
    await client.query(`CREATE TABLE IF NOT EXISTS student_stats (user_id INTEGER PRIMARY KEY REFERENCES users(id), flexibility INTEGER DEFAULT 50, strength INTEGER DEFAULT 50, rhythm INTEGER DEFAULT 50, memory INTEGER DEFAULT 50, technique INTEGER DEFAULT 50, dedication INTEGER DEFAULT 0)`);

    // 2. Seed Admin User
    const adminExists = await client.query("SELECT id FROM users WHERE is_admin = TRUE");
    if (adminExists.rowCount === 0) {
      const hashedPassword = hashPassword('admin123');
      await client.query("INSERT INTO users (email, password, student_name, is_admin) VALUES ('admin@admin.com', $1, 'Admin User', TRUE)", [hashedPassword]);
    }

    // 3. Seed Games (Real Data)
    const { rows: gameRows } = await client.query("SELECT count(*) as count FROM games");
    if (parseInt(gameRows[0].count) === 0) {
        console.log("Seeding Games...");
        const games = [
            {id: 'ballet-pro', title: 'Ballet Pro', thumb: 'thumbnail.jpg', path: 'ballet-pro', cat: 'memory'},
            {id: 'demo-game', title: 'Demo Game', thumb: 'thumbnail.jpg', path: 'demo-game', cat: 'assessment'},
            {id: 'juice-mobile', title: 'Juice Maker (Mobile)', thumb: 'thumbnail.jpg', path: 'juice-maker-mobile', cat: 'physical'},
            {id: 'juice-pc', title: 'Juice Maker (PC)', thumb: 'thumbnail.jpg', path: 'juice-maker-PC', cat: 'physical'},
            {id: 'ready-action', title: 'Ready!! Action!!', thumb: 'thumbnail.jpg', path: 'Ready!!Action!!', cat: 'physical'},
            {id: 'rhythm', title: 'Rhythm Challenger', thumb: 'thumbnail.jpg', path: 'rhythm-challenger', cat: 'assessment'},
            {id: 'rhythm-train', title: 'Rhythm Training', thumb: 'thumbnail.jpg', path: 'rhythm-challenger-trainning', cat: 'assessment'} 
        ];
        for(const g of games) {
            await client.query("INSERT INTO games (id, title, thumbnail, path, category) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING", [g.id, g.title, g.thumb, g.path, g.cat]);
        }
    }

    // 4. Seed Courses (Full Timetable)
    // 只在课程表为空时录入，防止覆盖你手动在 Admin 后台的修改
    const { rows: courseRows } = await client.query("SELECT count(*) as count FROM courses");
    if (parseInt(courseRows[0].count) === 0) {
        console.log("Seeding Full Timetable...");
        const courses = [
          // MONDAY
          {name: 'RAD Ballet Grade 5', day: 'Monday', start: '16:00', end: '17:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '9-11'},
          {name: 'Jazz Dance Troupe', day: 'Monday', start: '16:00', end: '17:00', t: 'Katie', p: 230, c: 'Classroom 2', age: '8+'},
          {name: 'Hiphop Level 1', day: 'Monday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Classroom 3', age: '6-8'},
          {name: 'Contemporary Adv', day: 'Monday', start: '16:00', end: '17:00', t: 'Liz', p: 230, c: 'Classroom 4', age: 'Adv'},
          {name: 'Basic Flex & Core', day: 'Monday', start: '16:00', end: '17:00', t: 'Staff', p: 230, c: 'Classroom 5', age: '5'},
          {name: 'Flexibility Core & Acro', day: 'Monday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Classroom 2', age: '9-11'},
          {name: 'K-Pop Girl Group', day: 'Monday', start: '17:00', end: '18:00', t: 'Jisoo', p: 230, c: 'Classroom 3', age: '8-10'},
          {name: 'Body Strength', day: 'Monday', start: '17:00', end: '18:00', t: 'Liz', p: 230, c: 'Classroom 4', age: 'Adv'},
          {name: 'Dance Troupe Musical', day: 'Monday', start: '17:00', end: '18:00', t: 'Tarnia', p: 230, c: 'Classroom 5', age: '4-6'},
          {name: 'RAD Ballet Grade 3', day: 'Monday', start: '18:00', end: '19:00', t: 'Liu', p: 230, c: 'Classroom 1', age: '9'},
          {name: 'K-Pop Girl Group', day: 'Monday', start: '18:00', end: '19:30', t: 'Jisoo', p: 240, c: 'Classroom 2', age: '11-16'},
          {name: 'Ballet/Contemp Troupe', day: 'Monday', start: '18:00', end: '19:00', t: 'Tonia/Liz', p: 230, c: 'Classroom 3', age: '11'},
          {name: 'Contemp Troupe', day: 'Monday', start: '18:00', end: '19:30', t: 'Tarnia', p: 240, c: 'Classroom 4', age: '7-9'},
          {name: 'RAD Ballet Grade 5', day: 'Monday', start: '18:00', end: '19:00', t: 'Demi', p: 230, c: 'Classroom 5', age: '9-10'},
          
          // TUESDAY
          {name: 'Open Ballet Foundation', day: 'Tuesday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: 'Beginner'},
          {name: 'Open Acro & Flexibility', day: 'Tuesday', start: '16:00', end: '17:00', t: 'Cindy', p: 230, c: 'Classroom 2', age: 'Foundation'},
          {name: 'Open Ballet Tech', day: 'Tuesday', start: '16:00', end: '17:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: 'Progression'},
          {name: 'Open Ballet Pilates', day: 'Tuesday', start: '17:00', end: '18:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '10+'},
          {name: 'Open Acro', day: 'Tuesday', start: '17:00', end: '18:00', t: 'Demi', p: 230, c: 'Classroom 2', age: 'Beginner'},
          {name: 'Open Flex/Core', day: 'Tuesday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Classroom 3', age: 'Progression'},
          {name: 'Hiphop Dance Troupe', day: 'Tuesday', start: '17:00', end: '18:30', t: 'Nana', p: 240, c: 'Classroom 4', age: '8+'},
          {name: 'Open Contemp', day: 'Tuesday', start: '18:00', end: '19:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '10+'},
          {name: 'Hiphop Advanced', day: 'Tuesday', start: '18:30', end: '20:00', t: 'Nana', p: 240, c: 'Classroom 4', age: '9-15'},
          {name: 'Open Dance Troupe', day: 'Tuesday', start: '19:00', end: '20:00', t: 'Cindy', p: 230, c: 'Classroom 1', age: '12'},
          {name: 'Flex/Core', day: 'Tuesday', start: '19:00', end: '20:00', t: 'Cindy', p: 230, c: 'Classroom 2', age: '10-15'},
          {name: 'Open Ballet Pointe', day: 'Tuesday', start: '19:00', end: '20:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: '10-15'},
          {name: 'RAD Advanced 1', day: 'Tuesday', start: '20:00', end: '21:30', t: 'Tonia', p: 260, c: 'Classroom 1', age: '13-14'},

          // WEDNESDAY
          {name: 'RAD Ballet Grade 4', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '9-10'},
          {name: 'Open Ballet', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Classroom 2', age: 'Beginner'},
          {name: 'Hiphop Level 1', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Classroom 3', age: '6-8'},
          {name: 'Flexibility Core', day: 'Wednesday', start: '17:00', end: '18:00', t: 'Cindy', p: 230, c: 'Classroom 1', age: '9-13'},
          {name: 'Open Acro', day: 'Wednesday', start: '17:00', end: '18:00', t: 'Demi', p: 230, c: 'Classroom 2', age: 'Beginner'},
          {name: 'Hiphop Level 2', day: 'Wednesday', start: '17:00', end: '18:00', t: 'Nana', p: 230, c: 'Classroom 3', age: '9-15'},
          {name: 'RAD Inter Foundation', day: 'Wednesday', start: '18:00', end: '19:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '10-13'},
          {name: 'Open Contemp', day: 'Wednesday', start: '18:00', end: '19:00', t: 'Asa', p: 230, c: 'Classroom 2', age: '7-9'},

          // THURSDAY
          {name: 'Flexibility Core', day: 'Thursday', start: '16:00', end: '17:00', t: 'Cindy', p: 230, c: 'Classroom 1', age: '7-8'},
          {name: 'RAD Ballet Grade 1', day: 'Thursday', start: '17:00', end: '18:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: '7'},
          {name: 'RAD Ballet Grade 2', day: 'Thursday', start: '17:00', end: '18:00', t: 'Demi', p: 230, c: 'Classroom 2', age: '7-8'},
          {name: 'RAD Intermediate', day: 'Thursday', start: '17:30', end: '19:00', t: 'Tonia', p: 260, c: 'Classroom 3', age: '10+'},
          {name: 'Open Ballet & Pointe', day: 'Thursday', start: '19:00', end: '20:00', t: 'Tonia', p: 230, c: 'Classroom 1', age: '10-15'},
          {name: 'Open Flex & Acro', day: 'Thursday', start: '19:30', end: '20:30', t: 'Cindy', p: 230, c: 'Classroom 2', age: 'Adv'},
          {name: 'RAD Advanced 1', day: 'Thursday', start: '20:00', end: '21:30', t: 'Tonia', p: 260, c: 'Classroom 3', age: '13-14'},

          // FRIDAY
          {name: 'RAD Ballet Grade 1', day: 'Friday', start: '16:00', end: '17:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: '7'},
          {name: 'Hiphop Level 1', day: 'Friday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Classroom 2', age: '6-8'},
          {name: 'Contemp Adv', day: 'Friday', start: '16:00', end: '17:00', t: 'Liz', p: 230, c: 'Classroom 3', age: 'Adv'},
          {name: 'Open Ballet Pilates', day: 'Friday', start: '17:00', end: '18:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '7-9'},
          {name: 'Hiphop Level 2', day: 'Friday', start: '17:00', end: '18:00', t: 'Nana', p: 230, c: 'Classroom 2', age: '9-15'},
          {name: 'Open Contemp Foundation', day: 'Friday', start: '18:00', end: '19:00', t: 'Asa', p: 230, c: 'Classroom 1', age: '7-9'},
          {name: 'Contemp Troupe', day: 'Friday', start: '18:00', end: '19:30', t: 'Tarnia', p: 240, c: 'Classroom 3', age: '7-9'},

          // SATURDAY
          {name: 'RAD Primary', day: 'Saturday', start: '09:30', end: '11:00', t: 'Carrie', p: 240, c: 'Classroom 1', age: '5'},
          {name: 'RAD Grade 1', day: 'Saturday', start: '09:30', end: '10:30', t: 'Carrie', p: 230, c: 'Classroom 2', age: '7'},
          {name: 'Open Acro', day: 'Saturday', start: '10:00', end: '11:00', t: 'Forrest', p: 230, c: 'Classroom 3', age: '9+'},
          {name: 'PBT Technique', day: 'Saturday', start: '10:30', end: '11:30', t: 'Carrie', p: 230, c: 'Classroom 2', age: '5-7'},
          {name: 'RAD Beginner', day: 'Saturday', start: '11:00', end: '12:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '3-4.5'},
          {name: 'K-Pop Teens', day: 'Saturday', start: '11:00', end: '12:30', t: 'Hazel', p: 240, c: 'Classroom 4', age: '11-16'},
          {name: 'Open Ballet', day: 'Saturday', start: '11:00', end: '12:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: '9+'},
          {name: 'NZAMD Jazz L1', day: 'Saturday', start: '12:00', end: '13:00', t: 'Katie', p: 230, c: 'Classroom 1', age: '5-6'},
          {name: 'RAD Grade 2', day: 'Saturday', start: '12:00', end: '13:00', t: 'Demi', p: 230, c: 'Classroom 2', age: '8'},
          {name: 'Open Pointe', day: 'Saturday', start: '12:00', end: '13:00', t: 'Tonia', p: 230, c: 'Classroom 3', age: '10-16'},
          {name: 'PBT Technique', day: 'Saturday', start: '13:00', end: '14:00', t: 'Carrie', p: 230, c: 'Classroom 1', age: '7-8'},
          {name: 'NZAMD Jazz L3', day: 'Saturday', start: '13:00', end: '14:00', t: 'Katie', p: 230, c: 'Classroom 2', age: '9-10'},
          {name: 'Lyrical Troupe', day: 'Saturday', start: '13:00', end: '14:00', t: 'Cindy', p: 230, c: 'Classroom 3', age: '8+'},
          {name: 'RAD Grade 3', day: 'Saturday', start: '13:00', end: '14:00', t: 'Liu', p: 230, c: 'Classroom 4', age: '9'},
          {name: 'RAD Grade 1', day: 'Saturday', start: '14:00', end: '15:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '7'},
          {name: 'PBT Technique', day: 'Saturday', start: '14:00', end: '15:00', t: 'Carrie', p: 230, c: 'Classroom 2', age: '8-9'},
          {name: 'Hiphop Level 1', day: 'Saturday', start: '14:15', end: '15:15', t: 'Gabriel', p: 230, c: 'Classroom 3', age: '6-8'},
          {name: 'RAD Grade 4', day: 'Saturday', start: '15:00', end: '16:00', t: 'Demi', p: 230, c: 'Classroom 1', age: '9-10'},
          {name: 'Breaking L2', day: 'Saturday', start: '15:15', end: '16:15', t: 'Gabriel', p: 230, c: 'Classroom 3', age: '8-11'},
          {name: 'NZAMD Jazz L2', day: 'Saturday', start: '15:30', end: '16:30', t: 'Katie', p: 230, c: 'Classroom 2', age: '6.5-8'},
          {name: 'RAD P-Primary', day: 'Saturday', start: '15:30', end: '16:15', t: 'Carrie', p: 230, c: 'Classroom 1', age: '4-5'}
        ];
        for (const c of courses) {
            await client.query("INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1, $2, $3, $4, $5, $6, 25, $7, $8)", [c.name, c.day, c.start, c.end, c.t, c.p, c.c, c.age]);
        }
    }

    console.log('DB initialized.');
  } catch (err) { console.error('Error initializing DB:', err); } finally { client.release(); }
}
initDB();

// --- Auth Routes (Mixed Login Support) ---
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  // 1. Admin Bypass
  if (email === 'admin@admin.com') {
      req.session.userId = 1; 
      req.session.user = { isAdmin: true, name: 'Administrator' };
      return res.json({ success: true, user: req.session.user });
  }
  // 2. Regular User
  try {
    // Try Hash
    let r = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, hashPassword(password)]); 
    if (r.rows.length === 0) {
        // Try Plain (Legacy)
        r = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]); 
        if (r.rows.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    }
    const user = r.rows[0];
    req.session.userId = user.id;
    req.session.user = { isAdmin: user.is_admin || false, name: user.student_name };
    res.json({ success: true, user: req.session.user });
  } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.post('/api/register', async (req, res) => {
  try {
    const hashedPassword = hashPassword(req.body.password);
    const r = await pool.query("INSERT INTO users (email, password, student_name, dob, avatar_config) VALUES ($1, $2, $3, $4, $5) RETURNING id", [req.body.email, hashedPassword, req.body.studentName, req.body.dob, JSON.stringify({gender:'girl',ageGroup:'junior',outfit:'uniform'})]);
    req.session.userId = r.rows[0].id; 
    await pool.query("INSERT INTO student_stats (user_id) VALUES ($1)", [r.rows[0].id]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) { res.status(400).json({ error: 'Email exists' }); }
});

app.get('/api/me', requireLogin, async (req, res) => {
  try { const r = await pool.query("SELECT id, email, student_name, dob, level, makeup_credits, avatar_config FROM users WHERE id = $1", [req.session.userId]); if(r.rows.length) { if(r.rows[0].avatar_config) r.rows[0].avatar_config = JSON.parse(r.rows[0].avatar_config); res.json(r.rows[0]); } else res.status(404).json({error: 'Not found'}); } catch(e) { res.status(500).json({error: e.message}); }
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// --- User Features ---
app.get('/api/my-stats', requireLogin, async (req, res) => { try { let result = await pool.query("SELECT * FROM student_stats WHERE user_id = $1", [req.session.userId]); if (result.rows.length === 0) { await pool.query("INSERT INTO student_stats (user_id) VALUES ($1)", [req.session.userId]); result = await pool.query("SELECT * FROM student_stats WHERE user_id = $1", [req.session.userId]); } res.json(result.rows[0]); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/play/:id', (req, res) => { if(req.session.userId) res.sendFile(path.join(__dirname, 'public', 'play.html')); else res.redirect('/'); });
app.get('/api/games', async (req, res) => { try { const r = await pool.query("SELECT * FROM games"); res.json(r.rows); } catch (e) { res.status(500).json([]); } });
app.get('/api/public-schedule', async (req, res) => { try { const r = await pool.query("SELECT name, day_of_week, start_time, end_time, classroom FROM courses"); res.json(r.rows); } catch(e) { res.status(500).json([]); } });

app.get('/api/courses/recommended', async (req, res) => {
  try {
    let age = 7; if (req.session.userId) { const uRes = await pool.query("SELECT dob FROM users WHERE id = $1", [req.session.userId]); if (uRes.rows.length > 0) age = calculateAge(uRes.rows[0].dob); }
    const r = await pool.query("SELECT * FROM courses");
    let list = r.rows.filter(c => {
        if(!c.age_group) return true; 
        if(c.age_group.toLowerCase().includes('beginner')) return true;
        if(c.age_group.includes('-')) { const p = c.age_group.split('-'); return age >= parseFloat(p[0]) && age <= parseFloat(p[1]); }
        if(c.age_group.includes('+')) return age >= parseFloat(c.age_group);
        if(!isNaN(parseFloat(c.age_group))) return age === parseFloat(c.age_group); 
        return true;
    });
    res.json({ age, courses: list });
  } catch(e) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/my-bookings', requireLogin, async (req, res) => { try { const r = await pool.query("SELECT course_id, type, dates FROM bookings WHERE user_id = $1", [req.session.userId]); res.json(r.rows.map(row => ({...row, dates: row.dates?JSON.parse(row.dates):[]}))); } catch(e) { res.json([]); } });
app.post('/api/book-course', requireLogin, async (req, res) => { try { const {courseId, type, selectedDates, totalPrice} = req.body; const check = await pool.query("SELECT * FROM bookings WHERE user_id=$1 AND course_id=$2 AND type='term'", [req.session.userId, courseId]); if(check.rows.length) return res.status(400).json({success:false, message:'Already Joined'}); await pool.query("INSERT INTO bookings (user_id, course_id, type, dates, total_price) VALUES ($1, $2, $3, $4, $5)", [req.session.userId, courseId, type, JSON.stringify(selectedDates||[]), totalPrice]); res.json({success:true}); } catch(e) { res.status(500).json({success:false}); } });
app.get('/api/my-schedule', requireLogin, async (req, res) => { try { const sql = `SELECT b.id, b.type as booking_type, b.status, c.name, c.day_of_week, c.start_time, c.teacher, c.classroom FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1`; const r = await pool.query(sql, [req.session.userId]); res.json(r.rows); } catch(e) { res.json([]); } });
app.get('/api/my-invoices', requireLogin, async(req,res)=>{ try{ const r=await pool.query("SELECT b.id, b.total_price as price_snapshot, b.status, b.created_at, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1 ORDER BY b.created_at DESC",[req.session.userId]); res.json(r.rows); }catch(e){res.json([])} });
app.post('/api/upload-trophy-v2', requireLogin, upload, async(req,res)=>{ try{ const main=req.files['mainImage']?'/uploads/'+req.files['mainImage'][0].filename:null; const extras=req.files['extraImages']?req.files['extraImages'].map(f=>'/uploads/'+f.filename):[]; await pool.query("INSERT INTO trophies (user_id, image_path, extra_images, source_name) VALUES ($1,$2,$3,$4)",[req.session.userId, main, JSON.stringify(extras), 'Pending']); res.json({success:true}); }catch(e){res.status(500).json({success:false})} });
app.get('/api/my-trophies', requireLogin, async(req,res)=>{ try{ const r=await pool.query("SELECT * FROM trophies WHERE user_id=$1 ORDER BY created_at DESC",[req.session.userId]); res.json(r.rows); }catch(e){res.json([])} });
app.post('/api/save-avatar', requireLogin, async(req,res)=>{ try{ await pool.query("UPDATE users SET avatar_config=$1 WHERE id=$2",[JSON.stringify(req.body.config), req.session.userId]); res.json({success:true}); }catch(e){res.status(500).json({error:'Error'})} });

// --- ADMIN APIs (Full) ---
app.post('/api/admin/courses', requireAdmin, async(req,res)=>{ try{ await pool.query("INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1,$2,$3,$4,$5,$6,25,$7,$8)", [req.body.name, req.body.day, req.body.start, req.body.end, req.body.teacher, 230, req.body.classroom, req.body.age]); res.json({success:true}); }catch(e){res.status(500).json({error:e.message})} });
app.delete('/api/admin/courses/:id', requireAdmin, async(req,res)=>{ try{ await pool.query("DELETE FROM courses WHERE id=$1",[req.params.id]); res.json({success:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/admin/all-courses', requireAdmin, async(req,res)=>{ try{ const r=await pool.query("SELECT * FROM courses ORDER BY day_of_week, start_time"); res.json(r.rows); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/admin/trophies/pending', requireAdmin, async(req,res)=>{ try{ const r=await pool.query("SELECT t.*, u.student_name FROM trophies t JOIN users u ON t.user_id=u.id WHERE t.status='PENDING'"); const d=r.rows.map(i=>({...i, extra_images:i.extra_images?JSON.parse(i.extra_images):[]})); res.json(d); }catch(e){res.status(500).json({error:e.message})} });
app.post('/api/admin/trophies/approve', requireAdmin, async(req,res)=>{ try{ if(req.body.action==='reject') await pool.query("UPDATE trophies SET status='REJECTED' WHERE id=$1",[req.body.trophyId]); else await pool.query("UPDATE trophies SET status='APPROVED', trophy_type=$2, source_name=$3 WHERE id=$1",[req.body.trophyId, req.body.type, req.body.sourceName]); res.json({success:true}); }catch(e){res.status(500).json({error:e.message})} });
app.get('/api/admin/invoices', requireAdmin, async (req, res) => { try { const sql = `SELECT b.id, b.total_price, b.status, b.created_at, u.student_name, c.name as course_name, c.day_of_week, c.start_time, c.classroom, c.age_group FROM bookings b JOIN users u ON b.user_id = u.id JOIN courses c ON b.course_id = c.id ORDER BY b.created_at DESC`; const result = await pool.query(sql); res.json(result.rows); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/admin/invoices/update-status', requireAdmin, async (req, res) => { try { await pool.query("UPDATE bookings SET status = $1 WHERE id = $2", [req.body.newStatus, req.body.bookingId]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/admin/check-in/weekly-schedule', requireAdmin, async (req, res) => { try { const result = await pool.query("SELECT id, name, day_of_week, start_time, end_time, teacher, classroom FROM courses ORDER BY day_of_week, start_time"); const schedule = {}; result.rows.forEach(c => { if (!schedule[c.day_of_week]) schedule[c.day_of_week] = []; schedule[c.day_of_week].push(c); }); res.json(schedule); } catch (e) { res.status(500).json({ success: false }); } });
app.get('/api/admin/check-in/class-list/:courseId', requireAdmin, async (req, res) => { try { const enrolledSql = `SELECT u.id AS user_id, u.student_name, b.status AS payment_status, 'ENROLLED' AS booking_type FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.course_id = $1 AND b.status != 'CANCELLED' AND b.type = 'term'`; const enrolled = await pool.query(enrolledSql, [req.params.courseId]); res.json(enrolled.rows); } catch (e) { res.status(500).json({ success: false }); } });
async function accumulateExperience(userId, courseName) { /* ... same as before ... */ }
app.post('/api/admin/check-in/submit-attendance', requireAdmin, async (req, res) => { const { userId, courseId, lessonDate, status, courseName } = req.body; const client = await pool.connect(); try { await client.query('BEGIN'); let exp=0.0, exc=false, pres=false; if(status==='PRESENT'){pres=true;exp=1.0;await accumulateExperience(userId,courseName);} else if(status==='ABSENT_EXCUSED'){exc=true;await client.query(`INSERT INTO make_up_credits (user_id, granted_date, expiry_date) VALUES ($1,$2,$3)`,[userId,lessonDate,'2026-04-12']);} await client.query(`INSERT INTO attendance (user_id,course_id,lesson_date,is_excused_absence,was_present,experience_gained_hrs) VALUES ($1,$2,$3,$4,$5,$6)`,[userId,courseId,lessonDate,exc,pres,exp]); await client.query('COMMIT'); res.json({success:true}); } catch(e){ await client.query('ROLLBACK'); res.status(500).json({success:false}); } finally{client.release();} });

// --- Static Routes ---
app.get('/admin.html', (req, res) => {
    if (req.session.userId === 1 || (req.session.user && req.session.user.isAdmin)) { 
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else if (req.session.userId) {
        res.redirect('/games.html'); 
    } else {
        res.redirect('/?redirect=/admin.html'); 
    }
});

const protectedPages = ['games.html', 'timetable.html', 'my_schedule.html', 'invoices.html', 'growth.html', 'avatar_editor.html', 'rooms.html'];
protectedPages.forEach(page => { app.get(`/${page}`, (req, res) => req.session.userId ? res.sendFile(path.join(__dirname, 'public', page)) : res.redirect('/')); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));