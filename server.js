const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database('./juice.db');

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: 'juice-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// --- Database Init ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    student_name TEXT,
    dob TEXT,
    level INTEGER DEFAULT 1,
    makeup_credits INTEGER DEFAULT 0,
    avatar_config TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    day_of_week TEXT,
    start_time TEXT,
    end_time TEXT,
    teacher TEXT,
    price REAL,
    casual_price REAL,
    classroom TEXT,
    age_group TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    course_id INTEGER,
    type TEXT,
    dates TEXT,
    total_price REAL,
    status TEXT DEFAULT 'UNPAID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS trophies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    image_path TEXT,
    extra_images TEXT,
    source_name TEXT,
    trophy_type TEXT, 
    status TEXT DEFAULT 'PENDING', 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Seed Courses if empty
  db.get("SELECT count(*) as count FROM courses", (err, row) => {
    if (row.count === 0) {
      const courses = [
        {name: 'Ballet Grade 1', day: 'Monday', start: '16:00', end: '17:00', t: 'Miss A', p: 230, c: 'Studio 1', age: '6-8'},
        {name: 'Jazz Junior', day: 'Monday', start: '17:00', end: '18:00', t: 'Miss B', p: 230, c: 'Studio 2', age: '6-8'},
        {name: 'HipHop Level 1', day: 'Wednesday', start: '16:00', end: '17:00', t: 'Nana', p: 230, c: 'Studio 3', age: '6-10'},
        {name: 'K-Pop Kids', day: 'Saturday', start: '10:00', end: '11:00', t: 'Mike', p: 240, c: 'Studio 1', age: '8-12'}
      ];
      const stmt = db.prepare("INSERT INTO courses (name, day_of_week, start_time, end_time, teacher, price, casual_price, classroom, age_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      courses.forEach(c => stmt.run(c.name, c.day, c.start, c.end, c.t, c.p, 25, c.c, c.age));
      stmt.finalize();
    }
  });
});

// --- Middleware ---
function requireLogin(req, res, next) {
  if (req.session.userId) next();
  else res.status(401).json({ error: 'Please login' });
}

// --- Upload Config ---
const storage = multer.diskStorage({
  destination: './public/uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// --- Auth API ---
app.post('/api/register', (req, res) => {
  const { email, password, studentName, dob } = req.body;
  db.run("INSERT INTO users (email, password, student_name, dob) VALUES (?, ?, ?, ?)", 
    [email, password, studentName, dob], 
    function(err) {
      if (err) return res.status(400).json({ error: 'Email already exists' });
      req.session.userId = this.lastID;
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (!row) return res.status(400).json({ error: 'Invalid credentials' });
    req.session.userId = row.id;
    res.json({ success: true, user: row });
  });
});

app.get('/api/me', requireLogin, (req, res) => {
  db.get("SELECT id, email, student_name, dob, level, makeup_credits, avatar_config FROM users WHERE id = ?", [req.session.userId], (err, row) => {
    if(row) {
        if(row.avatar_config) row.avatar_config = JSON.parse(row.avatar_config);
        res.json(row);
    } else {
        res.status(404).json({error: 'Not found'});
    }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- Course & Booking API ---

app.get('/api/courses/recommended', (req, res) => {
  // Simple logic: return all courses
  db.all("SELECT * FROM courses", (err, rows) => {
    res.json({ age: 7, courses: rows });
  });
});

// ★★★ 新增：获取我的已报名课程 (用于前端变灰逻辑) ★★★
app.get('/api/my-bookings', requireLogin, (req, res) => {
  db.all("SELECT course_id, type, dates FROM bookings WHERE user_id = ?", [req.session.userId], (err, rows) => {
    if(err) return res.json([]);
    // 解析 dates JSON 字符串
    const data = rows.map(r => ({
        course_id: r.course_id,
        type: r.type,
        dates: r.dates ? JSON.parse(r.dates) : []
    }));
    res.json(data);
  });
});

// ★★★ 修改：报名接口 (增加重复检查 & 错误提示) ★★★
app.post('/api/book-course', requireLogin, (req, res) => {
  const { courseId, type, selectedDates, totalPrice } = req.body;
  const userId = req.session.userId;

  // 1. 检查是否已经整学期报名
  db.get("SELECT * FROM bookings WHERE user_id = ? AND course_id = ? AND type = 'term'", [userId, courseId], (err, existing) => {
      if (existing) {
          // 如果已经报了整学期，直接阻止
          return res.status(400).json({ success: false, message: '您已报名该课程的整学期 (Full Term Already Joined)' });
      }

      // 2. 如果是整学期报名，检查是否有任何单次报名
      if (type === 'term') {
          // 这里简化逻辑：直接覆盖或允许，通常整学期优先级最高。
          // 插入新记录
          insertBooking();
      } else {
          // 3. 如果是单次报名 (Casual)，这里可以做更细致的日期检查，暂时直接插入
          insertBooking();
      }
  });

  function insertBooking() {
      const datesJson = JSON.stringify(selectedDates || []);
      db.run("INSERT INTO bookings (user_id, course_id, type, dates, total_price) VALUES (?, ?, ?, ?, ?)",
        [userId, courseId, type, datesJson, totalPrice],
        function(err) {
          if (err) return res.status(500).json({ success: false, message: 'Database Error' });
          res.json({ success: true, message: 'Booking Confirmed!' });
        }
      );
  }
});

// --- Other APIs (Schedule, Trophies, Avatar) ---

app.get('/api/my-schedule', requireLogin, (req, res) => {
    const sql = `
        SELECT b.id as booking_id, b.type as booking_type, b.status, c.name, c.day_of_week, c.start_time, c.teacher, c.classroom 
        FROM bookings b 
        JOIN courses c ON b.course_id = c.id 
        WHERE b.user_id = ?`;
    db.all(sql, [req.session.userId], (err, rows) => {
        if(err) res.json([]);
        else res.json(rows);
    });
});

app.get('/api/my-invoices', requireLogin, (req, res) => {
    const sql = `
        SELECT b.id, b.total_price as price_snapshot, b.status, b.created_at, c.name as course_name, c.day_of_week, c.start_time
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        WHERE b.user_id = ? ORDER BY b.created_at DESC`;
    db.all(sql, [req.session.userId], (err, rows) => res.json(rows));
});

// Trophies v2 (Multi-image)
app.post('/api/upload-trophy-v2', requireLogin, upload.fields([{ name: 'mainImage', maxCount: 1 }, { name: 'extraImages', maxCount: 9 }]), (req, res) => {
    const mainImg = req.files['mainImage'] ? '/uploads/' + req.files['mainImage'][0].filename : null;
    const extras = req.files['extraImages'] ? req.files['extraImages'].map(f => '/uploads/' + f.filename) : [];
    
    if(!mainImg) return res.status(400).json({success:false, error:'Main image missing'});

    db.run("INSERT INTO trophies (user_id, image_path, extra_images, source_name) VALUES (?, ?, ?, ?)", 
        [req.session.userId, mainImg, JSON.stringify(extras), 'Pending Review'],
        function(err) {
            if(err) res.status(500).json({success:false, error: err.message});
            else res.json({success:true});
        }
    );
});

app.get('/api/my-trophies', requireLogin, (req, res) => {
    db.all("SELECT * FROM trophies WHERE user_id = ? ORDER BY created_at DESC", [req.session.userId], (err, rows) => res.json(rows));
});

// Avatar
app.post('/api/save-avatar', requireLogin, (req, res) => {
    db.run("UPDATE users SET avatar_config = ? WHERE id = ?", [JSON.stringify(req.body.config), req.session.userId], (err) => {
        res.json({success:true});
    });
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));