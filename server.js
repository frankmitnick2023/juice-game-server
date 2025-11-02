// server.js - 终极游戏平台版
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

console.log('🚀 Starting FunX Gaming Platform...');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 会话管理
app.use(session({
  secret: process.env.SESSION_SECRET || 'funx-ultra-stable-secret-key-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24小时
}));

// 内存存储 - 使用Map防止内存泄漏
const users = new Map();
const games = new Map();
let userCount = 0;

// 预置一些游戏
const defaultGames = [
  {
    id: 1,
    name: "数字猜谜",
    description: "猜一个1-100之间的数字",
    type: "puzzle",
    difficulty: "easy",
    icon: "🔢"
  },
  {
    id: 2, 
    name: "记忆翻牌",
    description: "匹配相同的卡片",
    type: "memory",
    difficulty: "medium",
    icon: "🎴"
  },
  {
    id: 3,
    name: "快速点击",
    description: "在时间内点击尽可能多的目标",
    type: "action", 
    difficulty: "easy",
    icon: "🎯"
  },
  {
    id: 4,
    name: "单词拼写",
    description:根据提示拼写单词",
    type: "education",
    difficulty: "medium",
    icon: "📝"
  }
];

defaultGames.forEach(game => games.set(game.id, game));

// 主页 - 完整的游戏平台
app.get('/', (req, res) => {
  const user = req.session.user;
  
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>FunX - Gaming Platform</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
              font-family: 'Arial', sans-serif;
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
              font-size: 0.9rem;
          }
          .container {
              max-width: 1200px;
              margin: 0 auto;
              padding: 2rem;
          }
          .hero {
              text-align: center;
              margin-bottom: 3rem;
          }
          .hero h1 { font-size: 3rem; margin-bottom: 1rem; }
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
              backdrop-filter: blur(10px);
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
      </style>
  </head>
  <body>
      <div class="header">
          <div class="logo">🎮 FunX Games</div>
          <div class="user-info">
              ${user ? `
                  <span>欢迎, ${user.name}!</span>
                  <span>等级 ${user.level} | XP: ${user.xp}</span>
                  <a href="/logout" class="btn">退出</a>
              ` : `
                  <a href="/login" class="btn">登录</a>
                  <a href="/register" class="btn">注册</a>
              `}
          </div>
      </div>

      <div class="container">
          <div class="hero">
              <h1>欢迎来到 FunX 游戏平台</h1>
              <p>发现精彩游戏，赢取奖励和成就</p>
          </div>

          ${user ? `
              <div class="stats">
                  <div class="stat-card">
                      <h3>🏆 等级</h3>
                      <p>${user.level}</p>
                  </div>
                  <div class="stat-card">
                      <h3>⭐ 经验值</h3>
                      <p>${user.xp}</p>
                  </div>
                  <div class="stat-card">
                      <h3>🪙 金币</h3>
                      <p>${user.coins || 0}</p>
                  </div>
                  <div class="stat-card">
                      <h3>🎯 游戏次数</h3>
                      <p>${user.gamesPlayed || 0}</p>
                  </div>
              </div>

              <h2>热门游戏</h2>
              <div class="games-grid">
                  ${Array.from(games.values()).map(game => `
                      <div class="game-card" onclick="location.href='/game/${game.id}'">
                          <div class="game-icon">${game.icon}</div>
                          <h3>${game.name}</h3>
                          <p>${game.description}</p>
                          <p><small>难度: ${game.difficulty}</small></p>
                      </div>
                  `).join('')}
              </div>
          ` : `
              <div style="text-align: center; padding: 4rem 0;">
                  <h2>请登录开始游戏</h2>
                  <p style="margin: 2rem 0;">登录后即可体验所有精彩游戏</p>
                  <a href="/login" class="btn" style="padding: 15px 30px; font-size: 1.1rem;">立即登录</a>
              </div>
          `}
      </div>

      <script>
          // 自动重定向如果未登录
          ${!user ? `
              setTimeout(() => {
                  if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
                      window.location.href = '/login';
                  }
              }, 2000);
          ` : ''}
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
      <title>登录 - FunX</title>
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
          <a href="/" class="back">← 返回首页</a>
          <h2>登录 FunX</h2>
          <p>登录您的游戏账户</p>
          
          <div id="message"></div>
          
          <input type="email" id="email" placeholder="邮箱" value="test@funx.com">
          <input type="password" id="password" placeholder="密码" value="123456">
          <button onclick="login()">登录</button>
          
          <p style="text-align: center; margin-top: 20px;">
              没有账户? <a href="/register" style="color: #ff6b6b;">立即注册</a>
          </p>
      </div>

      <script>
          async function login() {
              const email = document.getElementById('email').value;
              const password = document.getElementById('password').value;
              const message = document.getElementById('message');
              
              if (!email || !password) {
                  showMessage('请输入邮箱和密码', 'error');
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
                      showMessage('登录成功! 跳转中...', 'success');
                      setTimeout(() => {
                          window.location.href = '/';
                      }, 1000);
                  } else {
                      showMessage('登录失败: ' + data.error, 'error');
                  }
              } catch (error) {
                  showMessage('网络错误，请重试', 'error');
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

// 注册页面
app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>注册 - FunX</title>
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
          <a href="/" class="back">← 返回首页</a>
          <h2>注册 FunX</h2>
          <p>创建您的游戏账户</p>
          
          <div id="message"></div>
          
          <input type="text" id="name" placeholder="用户名" value="测试用户">
          <input type="email" id="email" placeholder="邮箱" value="test@funx.com">
          <input type="password" id="password" placeholder="密码" value="123456">
          <button onclick="register()">注册</button>
          
          <p style="text-align: center; margin-top: 20px;">
              已有账户? <a href="/login" style="color: #ff6b6b;">立即登录</a>
          </p>
      </div>

      <script>
          async function register() {
              const name = document.getElementById('name').value;
              const email = document.getElementById('email').value;
              const password = document.getElementById('password').value;
              const message = document.getElementById('message');
              
              if (!name || !email || !password) {
                  showMessage('请填写所有字段', 'error');
                  return;
              }

              if (password.length < 6) {
                  showMessage('密码至少6位', 'error');
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
                      showMessage('注册成功! 自动登录中...', 'success');
                      setTimeout(() => {
                          window.location.href = '/';
                      }, 1500);
                  } else {
                      showMessage('注册失败: ' + data.error, 'error');
                  }
              } catch (error) {
                  showMessage('网络错误，请重试', 'error');
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

// 游戏页面
app.get('/game/:id', (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.redirect('/login');
  }
  
  const gameId = parseInt(req.params.id);
  const game = games.get(gameId);
  
  if (!game) {
    return res.redirect('/');
  }
  
  let gameHTML = '';
  
  switch(gameId) {
    case 1: // 数字猜谜
      gameHTML = `
        <div style="text-align: center;">
          <h2>🔢 数字猜谜</h2>
          <p>猜一个1-100之间的数字，你有7次机会！</p>
          <div style="margin: 2rem 0;">
            <input type="number" id="guess" min="1" max="100" placeholder="输入你的猜测" style="padding: 10px; font-size: 1.2rem;">
            <button onclick="makeGuess()" style="padding: 10px 20px; margin-left: 10px;">猜!</button>
          </div>
          <div id="result" style="min-height: 100px;"></div>
          <div id="attempts">剩余尝试次数: 7</div>
        </div>
        <script>
          let targetNumber = Math.floor(Math.random() * 100) + 1;
          let attemptsLeft = 7;
          
          function makeGuess() {
            if (attemptsLeft <= 0) {
              showResult('游戏结束! 数字是: ' + targetNumber, 'error');
              return;
            }
            
            const guess = parseInt(document.getElementById('guess').value);
            if (!guess || guess < 1 || guess > 100) {
              showResult('请输入1-100之间的数字', 'error');
              return;
            }
            
            attemptsLeft--;
            document.getElementById('attempts').textContent = '剩余尝试次数: ' + attemptsLeft;
            
            if (guess === targetNumber) {
              showResult('🎉 恭喜! 你猜对了!', 'success');
              submitGameResult(true, 100);
            } else if (guess < targetNumber) {
              showResult('📈 太小了! 再试一次', 'info');
            } else {
              showResult('📉 太大了! 再试一次', 'info');
            }
            
            document.getElementById('guess').value = '';
            document.getElementById('guess').focus();
            
            if (attemptsLeft === 0 && guess !== targetNumber) {
              showResult('😔 游戏结束! 数字是: ' + targetNumber, 'error');
              submitGameResult(false, 0);
            }
          }
          
          function showResult(message, type) {
            const result = document.getElementById('result');
            result.innerHTML = '<div style="padding: 10px; border-radius: 5px; margin: 10px 0; background: ' + 
                             (type === 'success' ? 'rgba(0,255,0,0.2)' : type === 'error' ? 'rgba(255,0,0,0.2)' : 'rgba(255,255,0,0.2)') + 
                             '">' + message + '</div>';
          }
        </script>
      `;
      break;
      
    case 2: // 记忆翻牌
      gameHTML = `
        <div style="text-align: center;">
          <h2>🎴 记忆翻牌</h2>
          <p>点击卡片找到所有匹配的对子!</p>
          <div id="memory-game" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; max-width: 400px; margin: 2rem auto;"></div>
          <div id="game-info">匹配对子: 0/8</div>
        </div>
        <script>
          const cards = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'];
          const gameCards = [...cards, ...cards].sort(() => Math.random() - 0.5);
          let flippedCards = [];
          let matchedPairs = 0;
          
          function initGame() {
            const gameBoard = document.getElementById('memory-game');
            gameBoard.innerHTML = '';
            
            gameCards.forEach((emoji, index) => {
              const card = document.createElement('div');
              card.className = 'memory-card';
              card.innerHTML = \`
                <div class="card-front">?</div>
                <div class="card-back">\${emoji}</div>
              \`;
              card.style.cssText = \`
                width: 80px; height: 80px; 
                background: #ff6b6b; 
                border-radius: 8px; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-size: 1.5rem; 
                cursor: pointer;
                position: relative;
                transform-style: preserve-3d;
                transition: transform 0.6s;
              \`;
              card.onclick = () => flipCard(card, index, emoji);
              gameBoard.appendChild(card);
            });
          }
          
          function flipCard(card, index, emoji) {
            if (flippedCards.length >= 2 || card.classList.contains('flipped')) return;
            
            card.style.transform = 'rotateY(180deg)';
            card.classList.add('flipped');
            flippedCards.push({card, emoji});
            
            if (flippedCards.length === 2) {
              checkMatch();
            }
          }
          
          function checkMatch() {
            const [card1, card2] = flippedCards;
            
            if (card1.emoji === card2.emoji) {
              matchedPairs++;
              document.getElementById('game-info').textContent = \`匹配对子: \${matchedPairs}/8\`;
              flippedCards = [];
              
              if (matchedPairs === 8) {
                setTimeout(() => {
                  showResult('🎉 恭喜! 你完成了游戏!', 'success');
                  submitGameResult(true, 150);
                }, 500);
              }
            } else {
              setTimeout(() => {
                card1.card.style.transform = 'rotateY(0deg)';
                card2.card.style.transform = 'rotateY(0deg)';
                card1.card.classList.remove('flipped');
                card2.card.classList.remove('flipped');
                flippedCards = [];
              }, 1000);
            }
          }
          
          initGame();
        </script>
      `;
      break;
      
    default:
      gameHTML = `<p>游戏开发中...</p>`;
  }
  
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
              padding: 20px;
          }
          .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 2rem;
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
              background: rgba(255,255,255,0.1);
              padding: 2rem;
              border-radius: 15px;
              backdrop-filter: blur(10px);
              max-width: 800px;
              margin: 0 auto;
          }
          .memory-card .card-front, .memory-card .card-back {
              position: absolute;
              width: 100%;
              height: 100%;
              backface-visibility: hidden;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 8px;
          }
          .memory-card .card-front { background: #ff6b6b; }
          .memory-card .card-back { background: #4ecdc4; transform: rotateY(180deg); }
      </style>
  </head>
  <body>
      <div class="header">
          <a href="/" class="btn">← 返回首页</a>
          <h1>${game.icon} ${game.name}</h1>
          <div>玩家: ${user.name}</div>
      </div>
      
      <div class="game-container">
          ${gameHTML}
      </div>
      
      <script>
          async function submitGameResult(win, score) {
              try {
                  await fetch('/api/game/result', {
                      method: 'POST',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({
                          gameId: ${gameId},
                          win: win,
                          score: score
                      })
                  });
              } catch (error) {
                  console.log('结果提交失败');
              }
          }
          
          function showResult(message, type) {
              alert(message);
          }
      </script>
  </body>
  </html>
  `);
});

// API 路由
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.json({ success: false, error: '请填写所有字段' });
    }
    
    // 检查邮箱是否已存在
    for (let user of users.values()) {
      if (user.email === email) {
        return res.json({ success: false, error: '邮箱已存在' });
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
    req.session.user = { id: user.id, name: user.name, email: user.email, level: user.level, xp: user.xp, coins: user.coins };
    
    res.json({ success: true, user: req.session.user });
    
  } catch (error) {
    res.json({ success: false, error: '注册失败' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.json({ success: false, error: '请输入邮箱和密码' });
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
      return res.json({ success: false, error: '用户不存在' });
    }
    
    const validPassword = await bcrypt.compare(password, userFound.password);
    if (!validPassword) {
      return res.json({ success: false, error: '密码错误' });
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
    res.json({ success: false, error: '登录失败' });
  }
});

app.post('/api/game/result', (req, res) => {
  try {
    const user = req.session.user;
    if (!user) {
      return res.json({ success: false, error: '未登录' });
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
          userData.coins += newLevel * 50; // 升级奖励
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
    res.json({ success: false, error: '结果提交失败' });
  }
});

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

// 错误处理
process.on('uncaughtException', (error) => {
  console.log('⚠️  Exception caught:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('⚠️  Rejection handled at:', promise);
});

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('🎮 FUNX GAMING PLATFORM');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
  console.log('✅ Games: 数字猜谜, 记忆翻牌, 更多...');
  console.log('✅ Login System: ENABLED');
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