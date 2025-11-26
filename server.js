const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const { createHash } = require('crypto');

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Multer for file uploads (支持多文件上传) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = req.session.userId || 'admin';
        cb(null, `${name}-${Date.now()}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } 
}).fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'extraImages', maxCount: 5 },
    { name: 'trophyImage', maxCount: 1 } 
]);
// --- END Multer ---

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

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

// Admin Check: User ID 1 is the admin
function requireAdmin(req, res, next) {
    // 假设 Admin 用户的 ID 永远是 1
    if (req.session.userId === 1) {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden' });
    }
}

// Helper function to hash passwords
function hashPassword(password) {
    return createHash('sha256').update(password).digest('hex');
}

// --- DB Setup (更新表结构以支持新功能) ---
async function initDB() {
  const client = await pool.connect();
  try {
    // users table (新增 is_admin 字段)
    await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, 
            email TEXT UNIQUE, 
            password TEXT, 
            student_name TEXT, 
            dob DATE, 
            level INTEGER DEFAULT 1, 
            makeup_credits INTEGER DEFAULT 0, 
            avatar_config TEXT,
            is_admin BOOLEAN DEFAULT FALSE
        )
    `);
    
    // courses table
    await client.query(`
        CREATE TABLE IF NOT EXISTS courses (
            id SERIAL PRIMARY KEY, 
            name TEXT, 
            day_of_week TEXT, 
            start_time TEXT, 
            end_time TEXT, 
            teacher TEXT, 
            price REAL, 
            casual_price REAL DEFAULT 25.0, 
            classroom TEXT, 
            age_group TEXT
        )
    `);
    
    // bookings table (关键: status 字段)
    await client.query(`
        CREATE TABLE IF NOT EXISTS bookings (
            id SERIAL PRIMARY KEY, 
            user_id INTEGER REFERENCES users(id), 
            course_id INTEGER REFERENCES courses(id), 
            type TEXT, 
            dates TEXT, 
            total_price REAL, 
            status TEXT DEFAULT 'UNPAID', 
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // trophies table (关键: extra_images, review_status, trophy_type)
    await client.query(`
        CREATE TABLE IF NOT EXISTS trophies (
            id SERIAL PRIMARY KEY, 
            user_id INTEGER REFERENCES users(id), 
            image_path TEXT, 
            extra_images TEXT DEFAULT '[]',
            source_name TEXT, 
            trophy_type TEXT, 
            review_status TEXT DEFAULT 'PENDING', 
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // Initial Admin Account (ID=1)
    const adminExists = await client.query("SELECT id FROM users WHERE is_admin = TRUE");
    if (adminExists.rowCount === 0) {
      const hashedPassword = hashPassword('admin123'); // 默认密码 admin123
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

// --- Auth & User Endpoints (省略部分注册/登录/登出代码以保持简洁，核心逻辑不变) ---

app.post('/api/register', async (req, res) => {
    // ... (Your registration logic remains the same)
    const { email, password, studentName, dob } = req.body;
    if (!email || !password || !studentName || !dob) return res.status(400).json({ error: 'Missing fields' });

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

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.json(null);
    try {
        const result = await pool.query("SELECT id, student_name, is_admin, avatar_config, level, makeup_credits FROM users WHERE id = $1", [req.session.userId]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            user.avatar_config = user.avatar_config ? JSON.parse(user.avatar_config) : {};
            res.json(user);
        } else {
            res.json(null);
        }
    } catch (e) {
        res.json(null);
    }
});

// Avatar Save
app.post('/api/save-avatar', requireLogin, async (req, res) => {
    const { config } = req.body;
    try {
        await pool.query("UPDATE users SET avatar_config = $1 WHERE id = $2", [JSON.stringify(config), req.session.userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// Trophy Upload (V2)
app.post('/api/upload-trophy-v2', requireLogin, upload, async (req, res) => {
    try {
        const mainImagePath = req.files['mainImage'] ? '/uploads/' + req.files['mainImage'][0].filename : null;
        if (!mainImagePath) {
            return res.status(400).json({ success: false, error: 'Main image is required.' });
        }

        const extraImagePaths = req.files['extraImages'] ? 
            req.files['extraImages'].map(f => '/uploads/' + f.filename) : 
            [];

        await pool.query(
            "INSERT INTO trophies (user_id, image_path, extra_images, source_name, review_status) VALUES ($1, $2, $3, $4, $5)",
            [req.session.userId, mainImagePath, JSON.stringify(extraImagePaths), 'Pending Review', 'PENDING']
        );

        res.json({ success: true });
    } catch (e) {
        console.error("Trophy upload error:", e);
        res.status(500).json({ success: false, error: 'Trophy upload failed' });
    }
});

// Get User Invoices
app.get('/api/my-invoices', requireLogin, async (req, res) => {
    try { 
        const r = await pool.query(
            "SELECT b.id, b.total_price AS price_snapshot, b.status, b.created_at, c.name AS course_name, c.day_of_week, c.start_time, c.price AS price_per_term FROM bookings b JOIN courses c ON b.course_id = c.id WHERE b.user_id = $1 ORDER BY b.created_at DESC",
            [req.session.userId]
        ); 
        res.json(r.rows.map(row => ({
            ...row,
            price_snapshot: row.price_snapshot || row.price_per_term,
        }))); 
    } catch (e) { 
        console.error("Error fetching invoices:", e);
        res.json([]); 
    }
});

// Booking Course
app.post('/api/book-course', requireLogin, async (req, res) => {
    const { courseId, type, selectedDates, totalPrice } = req.body;
    try {
        await pool.query(
            "INSERT INTO bookings (user_id, course_id, type, dates, total_price, status) VALUES ($1, $2, $3, $4, $5, $6)",
            [req.session.userId, courseId, type, JSON.stringify(selectedDates), totalPrice, 'UNPAID']
        );
        res.json({ success: true, message: `Successfully booked ${type} for $${totalPrice.toFixed(2)}` });
    } catch(e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Booking failed.' });
    }
});

// Get User Schedule
app.get('/api/my-schedule', requireLogin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.id AS booking_id, b.type AS booking_type, b.status AS payment_status, 
                c.id AS course_id, c.name, c.day_of_week, c.start_time, c.teacher, c.classroom
            FROM bookings b
            JOIN courses c ON b.course_id = c.id
            WHERE b.user_id = $1 AND b.status != 'CANCELLED'
            ORDER BY c.day_of_week, c.start_time
        `, [req.session.userId]);

        const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const schedule = result.rows.reduce((acc, current) => {
            const day = current.day_of_week;
            if (!acc[day]) { acc[day] = []; }
            acc[day].push(current);
            return acc;
        }, {});
        
        const sortedSchedule = daysOrder
            .filter(day => schedule[day])
            .map(day => ({ day: day, classes: schedule[day] }));

        res.json(sortedSchedule);
    } catch (e) {
        console.error("Error fetching schedule:", e);
        res.json([]);
    }
});

// Get Games List (Mock)
app.get('/api/games', (req, res) => {
    res.json([
        { id: 'game1', path: 'game1', title: 'Rhythm Master' },
        { id: 'game2', path: 'game2', title: 'Pose Challenge' },
    ]);
});


// --- ADMIN Endpoints (ID=1 only) ---

// 1. Course Management CRUD
app.get('/api/admin/all-courses', requireAdmin, async (req, res) => {
    try { 
        const r = await pool.query("SELECT * FROM courses ORDER BY day_of_week, start_time"); 
        res.json(r.rows); 
    } catch (e) { 
        res.status(500).json({ error: 'Failed to fetch courses' });
    }
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
    } catch (e) {
        res.status(500).json({ error: 'Failed to add course' });
    }
});

app.delete('/api/admin/courses/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM courses WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete course' });
    }
});


// 2. Invoice Management
app.get('/api/admin/invoices', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.id, b.total_price, b.status, b.created_at,
                u.student_name,
                c.name AS course_name, c.day_of_week, c.start_time
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN courses c ON b.course_id = c.id
            ORDER BY b.created_at DESC
        `);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch invoices' });
    }
});

app.post('/api/admin/invoices/update-status', requireAdmin, async (req, res) => {
    const { bookingId, newStatus } = req.body;
    if (!['PAID', 'UNPAID', 'CANCELLED'].includes(newStatus)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        await pool.query("UPDATE bookings SET status = $1 WHERE id = $2", [newStatus, bookingId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to update status' });
    }
});


// 3. Roll Call (点名系统: 获取学生姓名和付款状态)
app.get('/api/admin/roll-call/:courseId', requireAdmin, async (req, res) => {
    const { courseId } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT 
                u.student_name, 
                b.status AS payment_status
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE b.course_id = $1 AND b.status != 'CANCELLED'
            ORDER BY u.student_name
        `, [courseId]);
        
        const students = result.rows.map(row => ({
            student_name: row.student_name,
            payment_status: row.payment_status 
        }));
        
        res.json(students);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch roll call list' });
    }
});


// 4. Trophy Review Management
app.get('/api/admin/trophies/pending', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                t.id, t.user_id, t.image_path, t.extra_images, t.created_at, t.source_name,
                u.student_name
            FROM trophies t
            JOIN users u ON t.user_id = u.id
            WHERE t.review_status = 'PENDING'
            ORDER BY t.created_at ASC
        `);
        const data = result.rows.map(row => ({
            ...row,
            extra_images: JSON.parse(row.extra_images || '[]')
        }));
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch pending reviews' });
    }
});

app.post('/api/admin/trophies/approve', requireAdmin, async (req, res) => {
    const { trophyId, action, type, sourceName } = req.body;

    try {
        if (action === 'approve') {
            await pool.query(
                "UPDATE trophies SET review_status = 'APPROVED', trophy_type = $1, source_name = $2 WHERE id = $3",
                [type.toUpperCase(), sourceName, trophyId]
            );
            // 审批通过后，给学生等级 +1 (Mock logic for reward)
            const userResult = await pool.query("SELECT user_id FROM trophies WHERE id = $1", [trophyId]);
            if (userResult.rows.length > 0) {
                await pool.query("UPDATE users SET level = level + 1 WHERE id = $1", [userResult.rows[0].user_id]);
            }

        } else if (action === 'reject') {
            await pool.query(
                "UPDATE trophies SET review_status = 'REJECTED' WHERE id = $1",
                [trophyId]
            );
        } else {
            return res.status(400).json({ success: false, error: 'Invalid action' });
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to process review' });
    }
});


// --- Serve Static Files and Admin Routing ---

app.get('/admin.html', (req, res) => {
    if (req.session.userId === 1) { 
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else if (req.session.userId) {
        res.redirect('/games.html'); 
    } else {
        res.redirect('/?redirect=/admin.html'); 
    }
});

// Standard route for all other HTML files (with login check)
const protectedPages = ['games.html', 'timetable.html', 'my_schedule.html', 'invoices.html', 'growth.html', 'avatar_editor.html', 'rooms.html'];
protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (req.session.userId) {
            res.sendFile(path.join(__dirname, 'public', page));
        } else {
            res.redirect('/');
        }
    });
});

app.get('/play/:gameId', (req, res) => {
    if (req.session.userId) {
        res.sendFile(path.join(__dirname, 'public', 'play.html'));
    } else {
        res.redirect('/');
    }
});


// --- Server Listen ---

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});