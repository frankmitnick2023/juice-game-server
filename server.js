// server.js - 动态游戏加载版本
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting FunX Gaming Platform...');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/games', express.static('games')); // 提供 games 文件夹的静态文件

// 会话管理
app.use(session({
  secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// 内存存储
const users = new Map();
let userCount = 0;

// 动态加载游戏
function loadGames() {
  const games = new Map();
  const gamesDir = path.join(__dirname, 'games');
  
  try {
    if (!fs.existsSync(gamesDir)) {
      console.log('📁 Creating games directory...');
      fs.mkdirSync(gamesDir, { recursive: true });
      return games;
    }
    
    const gameFolders = fs.readdirSync(gamesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    console.log(`🎮 Found ${gameFolders.length} game folders:`, gameFolders);
    
    gameFolders.forEach((folder, index) => {
      const gameId = index + 1;
      const gamePath = path.join(gamesDir, folder);
      const configPath = path.join(gamePath, 'game.json');
      
      // 读取游戏配置
      let gameConfig = {
        id: gameId,
        name: folder,
        description: `A fun game: ${folder}`,
        type: "unknown",
        difficulty: "medium",
        icon: "🎮",
        category: "General",
        entryFile: "index.html"
      };
      
      try {
        if (fs.existsSync(configPath)) {
          const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          gameConfig = { ...gameConfig, ...configData };
        }
      } catch (error) {
        console.log(`⚠️ Error reading config for ${folder}:`, error.message);
      }
      
      // 检查入口文件
      const entryPath = path.join(gamePath, gameConfig.entryFile);
      if (!fs.existsSync(entryPath)) {
        // 尝试查找常见的入口文件
        const possibleEntries = ['index.html', 'game.html', 'main.html', `${folder}.html`];
        for (const entry of possibleEntries) {
          if (fs.existsSync(path.join(gamePath, entry))) {
            gameConfig.entryFile = entry;
            break;
          }
        }
      }
      
      games.set(gameId, gameConfig);
      console.log(`✅ Loaded game: ${gameConfig.name} (ID: ${gameId})`);
    });
    
  } catch (error) {
    console.log('❌ Error loading games:', error.message);
  }
  
  return games;
}

// 初始化游戏
let games = loadGames();

// API 路由
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.json({ success: false, error: 'Please fill all fields' });
    }
    
    // 检查邮箱是否已存在
    for (let user of users.values()) {
      if (user.email === email) {
        return res.json({ success: false, error: 'Email already exists' });
      }
    }
    
    userCount++;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = {
      id: userCount,
      name: name,
      email: email,
      password: hashedPassword,
      level: 1,
      xp: 0,
      coins: 100,
      gamesPlayed: 0,
      gamesWon: 0,
      joined: new Date().toISOString()
    };
    
    users.set(user.id, user);
    
    // 自动登录
    req.session.user = { 
      id: user.id, 
      name: user.name, 
      email: user.email, 
      level: user.level, 
      xp: user.xp, 
      coins: user.coins 
    };
    
    res.json({ success: true, user: req.session.user });
    
  } catch (error) {
    res.json({ success: false, error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.json({ success: false, error: 'Please enter email and password' });
    }
    
    // 查找用户
    let userFound = null;
    for (let user of users.values()) {
      if (user.email === email) {
        userFound = user;
        break;
      }
    }
    
    if (!userFound) {
      return res.json({ success: false, error: 'User not found' });
    }
    
    const validPassword = await bcrypt.compare(password, userFound.password);
    if (!validPassword) {
      return res.json({ success: false, error: 'Invalid password' });
    }
    
    // 创建会话
    req.session.user = { 
      id: userFound.id, 
      name: userFound.name, 
      email: userFound.email, 
      level: userFound.level, 
      xp: userFound.xp, 
      coins: userFound.coins,
      gamesPlayed: userFound.gamesPlayed || 0
    };
    
    res.json({ success: true, user: req.session.user });
    
  } catch (error) {
    res.json({ success: false, error: 'Login failed' });
  }
});

app.post('/api/game/result', (req, res) => {
  try {
    const user = req.session.user;
    if (!user) {
      return res.json({ success: false, error: 'Not logged in' });
    }
    
    const { gameId, win, score } = req.body;
    const userData = users.get(user.id);
    
    if (userData) {
      userData.gamesPlayed = (userData.gamesPlayed || 0) + 1;
      if (win) {
        userData.gamesWon = (userData.gamesWon || 0) + 1;
        userData.xp = (userData.xp || 0) + score;
        userData.coins = (userData.coins || 0) + Math.floor(score / 10);
        
        // 升级逻辑
        const newLevel = Math.floor(userData.xp / 100) + 1;
        if (newLevel > userData.level) {
          userData.level = newLevel;
          userData.coins += newLevel * 50;
        }
      }
      
      // 更新会话
      req.session.user = {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        level: userData.level,
        xp: userData.xp,
        coins: userData.coins,
        gamesPlayed: userData.gamesPlayed
      };
    }
    
    res.json({ success: true, user: req.session.user });
    
  } catch (error) {
    res.json({ success: false, error: 'Result submission failed' });
  }
});

// 页面路由
app.get('/', (req, res) => {
  const user = req.session.user;
  
  // 重新加载游戏（确保最新）
  games = loadGames();
  
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>FunX Gaming Platform</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
              font-family: Arial, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              min-height: 100vh;
          }
          .header {
              background: rgba(0,0,0,0.2);
              padding: 1rem 2rem;
              display: flex;
              justify-content: space-between;
              align-items: center;
          }
          .logo { font-size: 1.8rem; font-weight: bold; }
          .user-info { display: flex; align-items: center; gap: 1rem; }
          .btn {
              background: #ff6b6b;
              color: white;
              padding: 10px 20px;
              border-radius: 8px;
              text-decoration: none;
              border: none;
              cursor: pointer;
          }
          .container {
              max-width: 1200px;
              margin: 0 auto;
              padding: 2rem;
          }
          .hero {
              text-align: center;
              margin-bottom: 3rem;
              padding: 4rem 0;
          }
          .games-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
              gap: 2rem;
              margin-top: 2rem;
          }
          .game-card {
              background: rgba(255,255,255,0.1);
              padding: 2rem;
              border-radius: 15px;
              text-align: center;
              transition: transform 0.3s;
              cursor: pointer;
          }
          .game-card:hover {
              transform: translateY(-5px);
          }
          .game-icon { 
              font-size: 3rem; 
              margin-bottom: 1rem; 
          }
          .stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 1rem;
              margin: 2rem 0;
          }
          .stat-card {
              background: rgba(255,255,255,0.1);
              padding: 1.5rem;
              border-radius: 10px;
              text-align: center;
          }
          .empty-state {
              text-align: center;
              padding: 4rem 2rem;
              background: rgba(255,255,255,0.1);
              border-radius: 15px;
              margin: 2rem 0;
          }
      </style>
  </head>
  <body>
      <div class="header">
          <div class="logo">🎮 FunX Games</div>
          <div class="user-info">
              ${user ? `
                  <span>Welcome, ${user.name}!</span>
                  <span>Level ${user.level} | XP: ${user.xp}</span>
                  <a href="/logout" class="btn">Logout</a>
              ` : `
                  <a href="/login" class="btn">Login</a>
                  <a href="/register" class="btn">Register</a>
              `}
          </div>
      </div>

      <div class="container">
          <div class="hero">
              <h1>Welcome to FunX Gaming Platform</h1>
              <p>Discover amazing games and earn rewards!</p>
          </div>

          ${user ? `
              <div class="stats">
                  <div class="stat-card">
                      <h3>🏆 Level</h3>
                      <p>${user.level}</p>
                  </div>
                  <div class="stat-card">
                      <h3>⭐ XP</h3>
                      <p>${user.xp}</p>
                  </div>
                  <div class="stat-card">
                      <h3>🪙 Coins</h3>
                      <p>${user.coins || 0}</p>
                  </div>
                  <div class="stat-card">
                      <h3>🎯 Games Played</h3>
                      <p>${user.gamesPlayed || 0}</p>
                  </div>
              </div>

              <h2>Available Games (${games.size})</h2>
              
              ${games.size > 0 ? `
                  <div class="games-grid">
                      ${Array.from(games.values()).map(game => `
                          <div class="game-card" onclick="location.href='/play/${game.id}'">
                              <div class="game-icon">${game.icon}</div>
                              <h3>${game.name}</h3>
                              <p>${game.description}</p>
                              <p><small>Category: ${game.category} • Difficulty: ${game.difficulty}</small></p>
                          </div>
                      `).join('')}
                  </div>
              ` : `
                  <div class="empty-state">
                      <h3>🎮 No Games Found</h3>
                      <p>Add games to the 'games' folder to get started!</p>
                      <p><small>Each game should be in its own folder with an HTML file.</small></p>
                  </div>
              `}
          ` : `
              <div style="text-align: center; padding: 4rem 0;">
                  <h2>Please login to start playing</h2>
                  <p style="margin: 2rem 0;">Login to experience all amazing games</p>
                  <a href="/login" class="btn" style="padding: 15px 30px; font-size: 1.1rem;">Login Now</a>
                  <a href="/register" class="btn" style="padding: 15px 30px; font-size: 1.1rem; margin-left: 1rem; background: rgba(255,255,255,0.2);">Register</a>
              </div>
          `}
      </div>
  </body>
  </html>
  `);
});

// 注册页面
app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>Register - FunX</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
          body { 
              font-family: Arial; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white; 
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
          }
          .container {
              background: rgba(255,255,255,0.1);
              padding: 40px;
              border-radius: 15px;
              backdrop-filter: blur(10px);
              max-width: 400px;
              width: 100%;
          }
          .back { color: white; text-decoration: none; margin-bottom: 20px; display: inline-block; }
          input, button {
              width: 100%;
              padding: 15px;
              margin: 10px 0;
              border: none;
              border-radius: 8px;
              font-size: 1rem;
          }
          button { 
              background: #ff6b6b; 
              color: white; 
              cursor: pointer; 
          }
          .message { 
              padding: 10px; 
              border-radius: 5px; 
              margin: 10px 0; 
              text-align: center;
          }
          .error { background: rgba(255,0,0,0.2); }
          .success { background: rgba(0,255,0,0.2); }
      </style>
  </head>
  <body>
      <div class="container">
          <a href="/" class="back">← Back to Home</a>
          <h2>Register for FunX</h2>
          <p>Create your gaming account</p>
          
          <div id="message"></div>
          
          <input type="text" id="name" placeholder="Username" value="Test User">
          <input type="email" id="email" placeholder="Email" value="test@funx.com">
          <input type="password" id="password" placeholder="Password" value="123456">
          <button onclick="register()">Register</button>
          
          <p style="text-align: center; margin-top: 20px;">
              Have an account? <a href="/login" style="color: #ff6b6b;">Login now</a>
          </p>
      </div>

      <script>
          async function register() {
              const name = document.getElementById('name').value;
              const email = document.getElementById('email').value;
              const password = document.getElementById('password').value;
              const message = document.getElementById('message');
              
              if (!name || !email || !password) {
                  showMessage('Please fill all fields', 'error');
                  return;
              }

              if (password.length < 6) {
                  showMessage('Password must be at least 6 characters', 'error');
                  return;
              }

              try {
                  const response = await fetch('/api/register', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({name, email, password})
                  });
                  
                  const data = await response.json();
                  
                  if (data.success) {
                      showMessage('Registration successful! Auto-login...', 'success');
                      setTimeout(() => {
                          window.location.href = '/';
                      }, 1500);
                  } else {
                      showMessage('Registration failed: ' + data.error, 'error');
                  }
              } catch (error) {
                  showMessage('Network error, please try again', 'error');
              }
          }

          function showMessage(text, type) {
              const message = document.getElementById('message');
              message.innerHTML = text;
              message.className = 'message ' + type;
          }
      </script>
  </body>
  </html>
  `);
});

// 登录页面
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>Login - FunX</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
          body { 
              font-family: Arial; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white; 
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
          }
          .container {
              background: rgba(255,255,255,0.1);
              padding: 40px;
              border-radius: 15px;
              backdrop-filter: blur(10px);
              max-width: 400px;
              width: 100%;
          }
          .back { color: white; text-decoration: none; margin-bottom: 20px; display: inline-block; }
          input, button {
              width: 100%;
              padding: 15px;
              margin: 10px 0;
              border: none;
              border-radius: 8px;
              font-size: 1rem;
          }
          button { 
              background: #ff6b6b; 
              color: white; 
              cursor: pointer; 
          }
          .message { 
              padding: 10px; 
              border-radius: 5px; 
              margin: 10px 0; 
              text-align: center;
          }
          .error { background: rgba(255,0,0,0.2); }
          .success { background: rgba(0,255,0,0.2); }
      </style>
  </head>
  <body>
      <div class="container">
          <a href="/" class="back">← Back to Home</a>
          <h2>Login to FunX</h2>
          <p>Login to your gaming account</p>
          
          <div id="message"></div>
          
          <input type="email" id="email" placeholder="Email" value="test@funx.com">
          <input type="password" id="password" placeholder="Password" value="123456">
          <button onclick="login()">Login</button>
          
          <p style="text-align: center; margin-top: 20px;">
              No account? <a href="/register" style="color: #ff6b6b;">Register now</a>
          </p>
      </div>

      <script>
          async function login() {
              const email = document.getElementById('email').value;
              const password = document.getElementById('password').value;
              const message = document.getElementById('message');
              
              if (!email || !password) {
                  showMessage('Please enter email and password', 'error');
                  return;
              }

              try {
                  const response = await fetch('/api/login', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({email, password})
                  });
                  
                  const data = await response.json();
                  
                  if (data.success) {
                      showMessage('Login successful! Redirecting...', 'success');
                      setTimeout(() => {
                          window.location.href = '/';
                      }, 1000);
                  } else {
                      showMessage('Login failed: ' + data.error, 'error');
                  }
              } catch (error) {
                  showMessage('Network error, please try again', 'error');
              }
          }

          function showMessage(text, type) {
              const message = document.getElementById('message');
              message.innerHTML = text;
              message.className = 'message ' + type;
          }
      </script>
  </body>
  </html>
  `);
});

// 游戏播放页面 - 直接加载游戏文件夹中的HTML文件
app.get('/play/:id', (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.redirect('/login');
  }
  
  const gameId = parseInt(req.params.id);
  const game = games.get(gameId);
  
  if (!game) {
    return res.redirect('/');
  }
  
  const gamePath = path.join(__dirname, 'games', game.name, game.entryFile);
  
  try {
    if (fs.existsSync(gamePath)) {
      // 读取游戏HTML文件
      const gameHTML = fs.readFileSync(gamePath, 'utf8');
      
      // 包装游戏，添加平台导航和用户信息
      res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>${game.name} - FunX</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
              body { 
                  font-family: Arial; 
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white; 
                  margin: 0;
                  padding: 0;
              }
              .platform-header {
                  background: rgba(0,0,0,0.3);
                  padding: 1rem 2rem;
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  backdrop-filter: blur(10px);
              }
              .btn {
                  background: #ff6b6b;
                  color: white;
                  padding: 10px 20px;
                  border-radius: 8px;
                  text-decoration: none;
                  border: none;
                  cursor: pointer;
              }
              .game-container {
                  padding: 20px;
                  max-width: 1200px;
                  margin: 0 auto;
              }
          </style>
      </head>
      <body>
          <div class="platform-header">
              <a href="/" class="btn">← Back to Platform</a>
              <h2>🎮 ${game.name}</h2>
              <div>
                  <span>Player: ${user.name}</span>
                  <span style="margin-left: 1rem;">Level: ${user.level}</span>
              </div>
          </div>
          
          <div class="game-container">
              <!-- 游戏内容 -->
              ${gameHTML}
          </div>
          
          <script>
              // 提供游戏结果提交功能
              async function submitGameResult(win, score) {
                  try {
                      const response = await fetch('/api/game/result', {
                          method: 'POST',
                          headers: {'Content-Type': 'application/json'},
                          body: JSON.stringify({
                              gameId: ${gameId},
                              win: win,
                              score: score
                          })
                      });
                      
                      const data = await response.json();
                      if (data.success) {
                          console.log('Game result submitted successfully');
                      }
                  } catch (error) {
                      console.log('Result submission failed');
                  }
              }
              
              // 让游戏可以使用平台功能
              window.funxPlatform = {
                  submitScore: submitGameResult,
                  user: ${JSON.stringify(user)}
              };
          </script>
      </body>
      </html>
      `);
    } else {
      res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Game Not Found - FunX</title>
          <style>
              body { 
                  font-family: Arial; 
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white; 
                  text-align: center; 
                  padding: 100px 20px; 
              }
          </style>
      </head>
      <body>
          <h1>🎮 Game Not Found</h1>
          <p>The game file could not be loaded.</p>
          <p><small>Make sure the game folder contains an HTML file.</small></p>
          <a href="/" class="btn" style="display: inline-block; margin-top: 1rem;">Back to Platform</a>
      </body>
      </html>
      `);
    }
  } catch (error) {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Error - FunX</title>
        <style>
            body { 
                font-family: Arial; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white; 
                text-align: center; 
                padding: 100px 20px; 
            }
        </style>
    </head>
    <body>
        <h1>⚠️ Error Loading Game</h1>
        <p>There was an error loading the game.</p>
        <a href="/" class="btn" style="display: inline-block; margin-top: 1rem;">Back to Platform</a>
    </body>
    </html>
    `);
  }
});

// 退出登录
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    users: userCount,
    games: games.size,
    timestamp: Date.now()
  });
});

// 重新加载游戏端点（用于开发）
app.post('/api/reload-games', (req, res) => {
  games = loadGames();
  res.json({ success: true, games: Array.from(games.values()) });
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.log('⚠️ Exception caught:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('⚠️ Rejection handled at:', promise);
});

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('🎮 FUNX GAMING PLATFORM');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
  console.log('📁 Games folder: ./games/');
  console.log('✅ Dynamic game loading: ENABLED');
  console.log('✅ Routes: /, /register, /login, /play/:id');
  console.log('=================================');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('🔄 Port busy, retrying...');
    setTimeout(() => {
      app.listen(PORT + 1, '0.0.0.0');
    }, 1000);
  }
});