const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const { createHash } = require('crypto'); // 用于密码加密

const app = express();

// --- Postgres Connection Setup (Railway) ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Multer & Middleware ---
const upload = multer({ 
    storage: multer.diskStorage({ 
        destination: './public/uploads/', 
        filename: (req, file, cb) => cb(null, `${req.session.userId || 'admin'}-${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).fields([
    { name: 'mainImage', maxCount: 1 }, 
    { name: 'extraImages', maxCount: 5 }, 
    { name: 'trophyImage', maxCount: 1 } 
]);
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Helper function to hash passwords (Simple SHA256)
function hashPassword(password) {
    return createHash('sha256').update(password).digest('hex');
}

// --- Middleware ---
function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        if (req.path.startsWith('/admin')) {
            return res.redirect('/');
        }
        res.status(401).json({ error: 'Unauthorized' });
    }
}

function requireAdmin(req, res, next) {
    // 假设 Admin 用户的 ID 永远是 1
    if (req.session.userId === 1) {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden' });
    }
}

// --- DB Setup (包含所有表结构) ---
async function initDB() {
  const client = await pool.connect();
  try {
    // 1. users table
    await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, email TEXT UNIQUE, password TEXT, student_name TEXT, dob DATE, level INTEGER DEFAULT 1, makeup_credits INTEGER DEFAULT 0, avatar_config TEXT, is_admin BOOLEAN DEFAULT FALSE
        )
    `);
    
    // 2. courses table
    await client.query(`
        CREATE TABLE IF NOT EXISTS courses (
            id SERIAL PRIMARY KEY, name TEXT, day_of_week TEXT, start_time TEXT, end_time TEXT, teacher TEXT, price REAL, casual_price REAL DEFAULT 25.0, classroom TEXT, age_group TEXT
        )
    `);
    
    // 3. bookings table
    await client.query(`
        CREATE TABLE IF NOT EXISTS bookings (
            id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_id INTEGER REFERENCES courses(id), type TEXT, dates TEXT, total_price REAL, status TEXT DEFAULT 'UNPAID', created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 4. trophies table
    await client.query(`
        CREATE TABLE IF NOT EXISTS trophies (
            id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), image_path TEXT, extra_images TEXT DEFAULT '[]', source_name TEXT, trophy_type TEXT, review_status TEXT DEFAULT 'PENDING', created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 5. games table
    await client.query(`
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY, title TEXT, thumbnail TEXT, path TEXT
        )
    `);

    // 6. attendance table (考勤)
    await client.query(`
        CREATE TABLE IF NOT EXISTS attendance (
            id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_id INTEGER REFERENCES courses(id), lesson_date DATE, check_in_time TIMESTAMP, is_excused_absence BOOLEAN DEFAULT FALSE, was_present BOOLEAN DEFAULT FALSE, experience_gained_hrs REAL DEFAULT 0.0, make_up_credit_granted_id INTEGER, UNIQUE (user_id, course_id, lesson_date)
        )
    `);

    // 7. make_up_credits table (补课学分)
    await client.query(`
        CREATE TABLE IF NOT EXISTS make_up_credits (
            id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), granted_date DATE, expiry_date DATE, is_used BOOLEAN DEFAULT FALSE, used_for_booking_id INTEGER, related_attendance_id INTEGER REFERENCES attendance(id)
        )
    `);

    // 8. course_progress table (经验积累)
    await client.query(`
        CREATE TABLE IF NOT EXISTS course_progress (
            id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), course_category TEXT, cumulative_hours REAL DEFAULT 0.0, UNIQUE (user_id, course_category)
        )
    `);


    // Initial Admin Account (ID=1)
    const adminExists = await client.query("SELECT id FROM users WHERE is_admin = TRUE");
    if (adminExists.rowCount === 0) {
      const hashedPassword = hashPassword('admin123'); 
      await client.query("INSERT INTO users (email, password, student_name, is_admin) VALUES ('admin@admin.com', $1, 'Admin User', TRUE)", [hashedPassword]);
    }

    console.log('DB initialized and checked.');
  } catch (err) {
    console.error('Error initializing DB:', err);
  } finally {
    client.release();
  }
}

initDB();

// --- Helper Functions ---
function calculateAge(dob) {
  if (!dob) return 7; const diff = Date.now() - new Date(dob).getTime(); return Math.abs(new Date(diff).getUTCFullYear() - 1970); 
}

// 经验值积累与考试资格 (保持不变)
async function accumulateExperience(userId, courseName) {
    const client = await pool.connect();
    try {
        let category = 'Other';
        if (courseName.includes('Ballet') || courseName.includes('RAD')) category = 'RAD Ballet';
        else if (courseName.includes('Jazz') || courseName.includes('NZAMD')) category = 'NZAMD Jazz';

        await client.query(
            `INSERT INTO course_progress (user_id, course_category, cumulative_hours) 
             VALUES ($1, $2, $3) ON CONFLICT (user_id, course_category) 
             DO UPDATE SET cumulative_hours = course_progress.cumulative_hours + $3`,
            [userId, category, 1.0]
        );
        // 检查考试资格（30小时）
        const check = await client.query("SELECT cumulative_hours FROM course_progress WHERE user_id = $1 AND course_category = $2", [userId, category]);
        if (check.rows.length > 0 && check.rows[0].cumulative_hours >= 30) {
            console.log(`User ${userId} now eligible for ${category} exam.`);
        }
    } catch (e) { console.error('Experience accumulation failed:', e); } finally { client.release(); }
}


// --- AUTH & USER ENDPOINTS (密码加密已启用) ---
app.post('/api/register', async (req, res) => {
    const { email, password, studentName, dob } = req.body;
    try {
        const hashedPassword = hashPassword(password);
        await pool.query(
            "INSERT INTO users (email, password, student_name, dob, avatar_config) VALUES ($1, $2, $3, $4, $5)",
            [email, hashedPassword, studentName, dob, JSON.stringify({gender:'girl', ageGroup:'5-8', outfit:'default', bodyScale:1, useAiAvatar:false, aiAvatarUrl:''})]
        );
        res.json({ success: true, message: 'Registration successful' });
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashedPassword = hashPassword(password);
        const result = await pool.query("SELECT id, student_name, is_admin FROM users WHERE email = $1 AND password = $2", [email, hashedPassword]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            req.session.userId = user.id;
            req.session.isAdmin = user.is_admin;
            res.json({ success: true, user: { name: user.student_name, isAdmin: user.is_admin } });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.json(null);
    try {
        const result = await pool.query("SELECT id, student_name, is_admin, avatar_config, level, makeup_credits FROM users WHERE id = $1", [req.session.userId]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            user.avatar_config = user.avatar_config ? JSON.parse(user.avatar_config) : {};
            res.json(user);
        } else { res.json(null); }
    } catch (e) { res.json(null); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// --- ADMIN ENDPOINTS (核心功能) ---

// 1. Course Management CRUD
app.get('/api/admin/all-courses', requireAdmin, async (req, res) => {
    try { const r = await pool.query("SELECT * FROM courses ORDER BY day_of_week, start_time"); res.json(r.rows); } catch (e) { res.status(500).json({ error: 'Failed to fetch courses' }); }
});

app.post('/api/admin/courses', requireAdmin, async (req, res) => {
    const { name, day, start, end, teacher, price, classroom, age } = req.body;
    try {
        const finalPrice = price || 230.0; 
        const casualPrice = finalPrice / 10;
        await pool.query(
            "INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
            [name, day, start, end, teacher, finalPrice, casualPrice, classroom, age]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to add course' }); }
});

app.delete('/api/admin/courses/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM courses WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to delete course' }); }
});


// 2. Invoice Management (R1/R2)
app.get('/api/admin/invoices', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.id, b.total_price, b.status, b.created_at, u.student_name, c.name as course_name, c.day_of_week, c.start_time
            FROM bookings b JOIN users u ON b.user_id = u.id JOIN courses c ON b.course_id = c.id ORDER BY b.created_at DESC
        `);
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch invoices' }); }
});

app.post('/api/admin/invoices/update-status', requireAdmin, async (req, res) => {
    const { bookingId, newStatus } = req.body;
    if (!['PAID', 'UNPAID', 'CANCELLED'].includes(newStatus)) return res.status(400).json({ error: 'Invalid status' });

    try {
        await pool.query("UPDATE bookings SET status = $1 WHERE id = $2", [newStatus, bookingId]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed to update status' }); }
});


// 3. Roll Call (点名系统)
app.get('/api/admin/check-in/weekly-schedule', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, day_of_week, start_time, end_time, teacher, classroom FROM courses ORDER BY day_of_week, start_time");
        const schedule = {};
        result.rows.forEach(c => {
            if (!schedule[c.day_of_week]) schedule[c.day_of_week] = [];
            schedule[c.day_of_week].push(c);
        });
        res.json(schedule);
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/admin/check-in/class-list/:courseId', requireAdmin, async (req, res) => {
    const { courseId } = req.params;
    const client = await pool.connect();
    try {
        const enrolledSql = `
            SELECT u.id AS user_id, u.student_name, b.status AS payment_status, b.type AS booking_type
            FROM bookings b JOIN users u ON b.user_id = u.id
            WHERE b.course_id = $1 AND b.status != 'CANCELLED' AND b.type = 'term'
        `;
        const enrolled = await client.query(enrolledSql, [courseId]);
        
        const makeupSql = `
            SELECT u.id AS user_id, u.student_name, 'MAKEUP' AS booking_type
            FROM make_up_credits mc JOIN users u ON mc.user_id = u.id
            WHERE mc.is_used = FALSE AND mc.expiry_date >= NOW()
            GROUP BY u.id, u.student_name
        `;
        const makeupStudents = await client.query(makeupSql);

        const studentMap = new Map();
        [...enrolled.rows, ...makeupStudents.rows].forEach(s => {
            if (!studentMap.has(s.user_id) || s.booking_type === 'ENROLLED') {
                studentMap.set(s.user_id, { user_id: s.user_id, student_name: s.student_name, payment_status: s.payment_status || 'PAID', booking_type: s.booking_type });
            }
        });
        res.json(Array.from(studentMap.values()));
    } catch (e) { res.status(500).json({ success: false }); } finally { client.release(); }
});

app.post('/api/admin/check-in/submit-attendance', requireAdmin, async (req, res) => {
    const { userId, courseId, lessonDate, status, courseName } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let experienceGained = 0.0;
        let isExcused = false;
        let wasPresent = false;
        let creditGranted = null;

        if (status === 'PRESENT') {
            wasPresent = true; experienceGained = 1.0;
            await accumulateExperience(userId, courseName);
        } else if (status === 'ABSENT_UNEXCUSED') {
            isExcused = false; wasPresent = false;
        } else if (status === 'ABSENT_EXCUSED') {
            isExcused = true; wasPresent = false;
            const creditRes = await client.query(`INSERT INTO make_up_credits (user_id, granted_date, expiry_date) VALUES ($1, $2, $3) RETURNING id`, [userId, lessonDate, '2026-04-12']);
            creditGranted = creditRes.rows[0].id;
        }

        await client.query(`INSERT INTO attendance (user_id, course_id, lesson_date, check_in_time, is_excused_absence, was_present, experience_gained_hrs, make_up_credit_granted_id) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)`, [userId, courseId, lessonDate, isExcused, wasPresent, experienceGained, creditGranted]);

        await client.query('COMMIT');
        res.json({ success: true, message: `Attendance recorded: ${status}` });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, message: e.message });
    } finally { client.release(); }
});

// --- Other (Trophy Review, Game, User) ---
app.get('/api/my-trophies', requireLogin, async (req, res) => {
    try { const r = await pool.query("SELECT * FROM trophies WHERE user_id=$1 ORDER BY created_at DESC", [req.session.userId]); res.json(r.rows); } catch(e) { res.json([]) }
});
app.get('/api/my-invoices', requireLogin, async (req, res) => {
    try { const r = await pool.query("SELECT b.id, b.total_price as price_snapshot, b.status, b.created_at, c.name as course_name, c.day_of_week, c.start_time FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1 ORDER BY b.created_at DESC", [req.session.userId]); res.json(r.rows); } catch(e) { res.json([]) }
});
app.get('/api/games', async (req, res) => {
    try { const r = await pool.query("SELECT * FROM games"); res.json(r.rows); } catch (e) { res.status(500).json([]); }
});
app.post('/api/upload-trophy-v2', requireLogin, upload, async (req, res) => {
    try { 
        const main=req.files['mainImage']?'/uploads/'+req.files['mainImage'][0].filename:null;
        const extras=req.files['extraImages']?req.files['extraImages'].map(f=>'/uploads/'+f.filename):[];
        await pool.query("INSERT INTO trophies (user_id, image_path, extra_images, source_name) VALUES ($1,$2,$3,$4)",[req.session.userId, main, JSON.stringify(extras), 'Pending']);
        res.json({success:true});
    }catch(e){res.status(500).json({success:false})}
});
app.post('/api/save-avatar', requireLogin, async(req,res)=>{
    try{ await pool.query("UPDATE users SET avatar_config=$1 WHERE id=$2",[JSON.stringify(req.body.config), req.session.userId]); res.json({success:true}); }catch(e){res.status(500).json({error:'Error'})}
});

// --- Serve Static Files and Admin Routing ---
app.get('/admin.html', (req, res) => {
    if (req.session.userId === 1) { res.sendFile(path.join(__dirname, 'public', 'admin.html')); } 
    else if (req.session.userId) { res.redirect('/games.html'); } 
    else { res.redirect('/?redirect=/admin.html'); }
});

const protectedPages = ['games.html', 'timetable.html', 'my_schedule.html', 'invoices.html', 'growth.html', 'avatar_editor.html', 'rooms.html'];
protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (req.session.userId) { res.sendFile(path.join(__dirname, 'public', page)); } else { res.redirect('/'); }
    });
});
app.get('/play/:gameId', (req, res) => {
    if (req.session.userId) { res.sendFile(path.join(__dirname, 'public', 'play.html')); } else { res.redirect('/'); }
});


// --- Server Listen ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server is running on port ${PORT}`); });