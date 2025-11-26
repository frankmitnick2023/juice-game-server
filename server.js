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

// --- Constants for Business Logic ---
const COURSE_EXP_RATE_HRS = 1.0; // 每堂课获得的经验小时数
const TERM_END_DATE = '2026-04-12'; // 补课学分的过期日期

// --- Multer & Middleware (保持不变) ---
const upload = multer({ storage: multer.diskStorage({ destination: './public/uploads/', filename: (req, file, cb) => cb(null, `${req.session.userId || 'admin'}-${Date.now()}${path.extname(file.originalname)}`)})}).fields([
    { name: 'mainImage', maxCount: 1 }, { name: 'extraImages', maxCount: 5 }, { name: 'trophyImage', maxCount: 1 } 
]);
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
function hashPassword(password) { return createHash('sha256').update(password).digest('hex'); }
function requireLogin(req, res, next) { if (req.session.userId) { next(); } else { if (req.path.startsWith('/admin')) { return res.redirect('/'); } res.status(401).json({ error: 'Unauthorized' }); } }
function requireAdmin(req, res, next) { if (req.session.userId === 1) { next(); } else { res.status(403).json({ error: 'Forbidden' }); } }

// --- DB Setup (新增3个考勤表) ---
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (...)`); // Simplified for display
    await client.query(`CREATE TABLE IF NOT EXISTS courses (...)`);
    await client.query(`CREATE TABLE IF NOT EXISTS bookings (...)`);
    await client.query(`CREATE TABLE IF NOT EXISTS trophies (...)`);
    await client.query(`CREATE TABLE IF NOT EXISTS games (...)`);
    
    // ★★★ 新增表 1: 考勤记录 (Attendance) ★★★
    await client.query(`
        CREATE TABLE IF NOT EXISTS attendance (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            course_id INTEGER REFERENCES courses(id),
            lesson_date DATE,
            check_in_time TIMESTAMP,
            is_excused_absence BOOLEAN DEFAULT FALSE,
            was_present BOOLEAN DEFAULT FALSE,
            experience_gained_hrs REAL DEFAULT 0.0,
            make_up_credit_granted_id INTEGER,
            UNIQUE (user_id, course_id, lesson_date)
        )
    `);

    // ★★★ 新增表 2: 补课学分 (Make-up Credits) ★★★
    await client.query(`
        CREATE TABLE IF NOT EXISTS make_up_credits (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            granted_date DATE,
            expiry_date DATE,
            is_used BOOLEAN DEFAULT FALSE,
            used_for_booking_id INTEGER,
            related_attendance_id INTEGER REFERENCES attendance(id)
        )
    `);

    // ★★★ 新增表 3: 课程经验积累 (Course Progress) ★★★
    await client.query(`
        CREATE TABLE IF NOT EXISTS course_progress (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            course_category TEXT, -- e.g., 'RAD Ballet', 'NZAMD Jazz'
            cumulative_hours REAL DEFAULT 0.0,
            UNIQUE (user_id, course_category)
        )
    `);

    // [此处省略 Admin Account & Seeding Logic]
    console.log('DB initialized and checked.');
  } catch (err) { console.error('Error initializing DB:', err); } finally { client.release(); }
}
initDB();

// --- Helper Logic (经验值积累与考试资格) ---

async function accumulateExperience(userId, courseName) {
    const client = await pool.connect();
    try {
        // 简化：如果课程名包含 'Ballet' 或 'Jazz'，则分别归类
        let category = 'Other';
        if (courseName.includes('Ballet') || courseName.includes('RAD')) {
            category = 'RAD Ballet';
        } else if (courseName.includes('Jazz') || courseName.includes('NZAMD')) {
            category = 'NZAMD Jazz';
        }

        // 插入或更新经验值
        await client.query(
            `INSERT INTO course_progress (user_id, course_category, cumulative_hours) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (user_id, course_category) 
             DO UPDATE SET cumulative_hours = course_progress.cumulative_hours + $3`,
            [userId, category, COURSE_EXP_RATE_HRS]
        );

        // 检查考试资格 (Mock Logic)
        const check = await client.query("SELECT cumulative_hours FROM course_progress WHERE user_id = $1 AND course_category = $2", [userId, category]);
        if (check.rows.length > 0) {
            const hours = check.rows[0].cumulative_hours;
            if (hours >= 30) {
                console.log(`User ${userId} now eligible for ${category} exam.`);
                // 可以在这里触发通知
            }
        }
    } catch (e) {
        console.error('Experience accumulation failed:', e);
    } finally {
        client.release();
    }
}


// --- ADMIN Check In / Attendance API (R1, R3, R4) ---

// R1: 重命名 Roll Call Tab
// R3: 提前请假 (Excused Absence) - 获得补课学分
app.post('/api/admin/check-in/excuse-absence', requireAdmin, async (req, res) => {
    const { userId, courseId, lessonDate } = req.body; // lessonDate: YYYY-MM-DD
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. 记录考勤: 标记为 "请假" (Excused Absence)
        const attRes = await client.query(
            `INSERT INTO attendance (user_id, course_id, lesson_date, is_excused_absence, was_present) 
             VALUES ($1, $2, $3, TRUE, FALSE) RETURNING id`,
            [userId, courseId, lessonDate]
        );
        const attendanceId = attRes.rows[0].id;

        // 2. 发放补课学分 (Credit)
        const creditRes = await client.query(
            `INSERT INTO make_up_credits (user_id, granted_date, expiry_date, related_attendance_id) 
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [userId, lessonDate, TERM_END_DATE, attendanceId]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: "Absence excused, make-up credit granted." });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Excuse Absence failed:', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        client.release();
    }
});


// R3/R4: 提交点名 (Check In) - 处理到课、旷课、经验累积
app.post('/api/admin/check-in/submit-attendance', requireAdmin, async (req, res) => {
    const { userId, courseId, lessonDate, status } = req.body; // status: 'PRESENT', 'UNEXCUSED', 'ABSENT_CREDIT'
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let experienceGained = 0.0;
        let isExcused = false;
        let wasPresent = false;
        let creditGranted = null;

        // --- 逻辑分支 ---
        if (status === 'PRESENT') {
            // 签到：到课，获得经验值
            wasPresent = true;
            experienceGained = COURSE_EXP_RATE_HRS;
            
            // 经验值累积
            await accumulateExperience(userId, courseId); // Note: Simplified function call
        
        } else if (status === 'ABSENT_UNEXCUSED') {
            // 旷课：未到课，无补课学分，无经验
            isExcused = false; 
            wasPresent = false;
        
        } else if (status === 'ABSENT_EXCUSED') {
            // 请假（通过 Check In Modal 标记，但没有提前请假 API 走）：获得补课学分
            isExcused = true;
            
            const creditRes = await client.query(
                `INSERT INTO make_up_credits (user_id, granted_date, expiry_date) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [userId, lessonDate, TERM_END_DATE]
            );
            creditGranted = creditRes.rows[0].id;
        }

        // 写入考勤记录
        await client.query(
            `INSERT INTO attendance (user_id, course_id, lesson_date, check_in_time, is_excused_absence, was_present, experience_gained_hrs, make_up_credit_granted_id)
             VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)`,
             [userId, courseId, lessonDate, isExcused, wasPresent, experienceGained, creditGranted]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: `Attendance recorded: ${status}` });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Submit Attendance failed:', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        client.release();
    }
});


// R2: 获取周视图时间块 (供 admin.html 渲染使用)
app.get('/api/admin/check-in/weekly-schedule', requireAdmin, async (req, res) => {
    try {
        // Fetch all courses for the week view grid
        const result = await pool.query("SELECT id, name, day_of_week, start_time, end_time, teacher FROM courses ORDER BY day_of_week, start_time");
        
        // Group and return
        const schedule = {};
        result.rows.forEach(c => {
            if (!schedule[c.day_of_week]) {
                schedule[c.day_of_week] = [];
            }
            schedule[c.day_of_week].push(c);
        });

        res.json(schedule);
    } catch (e) {
        console.error('Weekly Schedule fetch failed:', e);
        res.status(500).json({ success: false });
    }
});

// R2: 获取本次课点名名单 ( enrolled + make-up students)
app.get('/api/admin/check-in/class-list/:courseId', requireAdmin, async (req, res) => {
    const { courseId } = req.params;
    const client = await pool.connect();
    try {
        // 1. 获取所有报名的学生及其支付状态
        const enrolledSql = `
            SELECT 
                u.id AS user_id, u.student_name, b.status AS payment_status, 'ENROLLED' AS booking_type
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            WHERE b.course_id = $1 AND b.status != 'CANCELLED' AND b.type = 'term'
        `;
        const enrolled = await client.query(enrolledSql, [courseId]);
        
        // 2. 获取所有可用于补课的学分 (简单实现：获取所有未用且未过期的学分)
        const makeupSql = `
            SELECT 
                u.id AS user_id, u.student_name, 'MAKEUP' AS booking_type
            FROM make_up_credits mc
            JOIN users u ON mc.user_id = u.id
            WHERE mc.is_used = FALSE AND mc.expiry_date >= NOW()
            GROUP BY u.id, u.student_name
        `;
        const makeupStudents = await client.query(makeupSql);

        // 3. 合并名单 (去重)
        const studentMap = new Map();
        [...enrolled.rows, ...makeupStudents.rows].forEach(s => {
             // 优先保留正式报名状态
            if (!studentMap.has(s.user_id) || s.booking_type === 'ENROLLED') {
                studentMap.set(s.user_id, {
                    user_id: s.user_id,
                    student_name: s.student_name,
                    payment_status: s.payment_status || 'PAID', // 补课默认认为已付费
                    booking_type: s.booking_type
                });
            }
        });
        
        // 4. 返回最终名单
        res.json(Array.from(studentMap.values()));
    } catch (e) {
        console.error('Fetch Class List failed:', e);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});


// (All other APIs remain here, including Admin/Courses, Admin/Invoices, Admin/Trophies, etc.)
// ... (Omitted for brevity in this planning block) ...

// --- Server Listen ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server is running on port ${PORT}`); });