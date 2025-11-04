// ==========================
// Juice Game Server (MVP)
// ==========================
import express from "express";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import pkg from "pg";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- PostgreSQL ----------
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ---------- Middlewares ----------
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/games", express.static(path.join(__dirname, "games")));

// ---------- 初始化数据库 ----------
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      level INT DEFAULT 1,
      coins INT DEFAULT 0,
      total_time INT DEFAULT 0
    );
  `);
  console.log("✅ Database initialized");
}
initDB();

// ---------- 注册 ----------
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, hashed]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      res.status(400).json({ error: "Email already registered" });
    } else {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
});

// ---------- 登录 ----------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    res.json({ success: true, user: { id: user.id, email: user.email, level: user.level, coins: user.coins } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- 获取游戏列表 ----------
import fs from "fs";
app.get("/api/games", (req, res) => {
  const manifestPath = path.join(__dirname, "games", "game-manifest.json");
  if (!fs.existsSync(manifestPath)) return res.json([]);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  res.json(manifest.games);
});

// ---------- 播放页面 ----------
app.get("/play/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "play.html"));
});

// ---------- 启动 ----------
app.listen(PORT, () => console.log(`🚀 Juice Game server running on port ${PORT}`));
