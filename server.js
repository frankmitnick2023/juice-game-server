// server.js - 终极游戏平台修复版
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
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// 内存存储
const users = new Map();
const games = new Map();
let userCount = 0;

// 预置游戏
const defaultGames = [
  {
    id: 1,
    name: "Number Guess",
    description: "Guess a number between 1-100",
    type: "puzzle",
    difficulty: "easy",
    icon: "🔢"
  },
  {
    id: 2, 
    name: "Memory Cards",
    description: "Match identical cards",
    type: "memory",
    difficulty: "medium",
    icon: "🎴"
  },
  {
    id: 3,
    name: "Quick Click",
    description: "Click targets as fast as you can",
    type: "action", 
    difficulty: "easy",
    icon: "🎯"
  },
  {
    id: 4,
    name: "Word Spell",
    description: "Spell words based on hints",
    type: "education",
    difficulty: "medium",
    icon: "📝"
  }
];

defaultGames.forEach(game => games.set(game.id, game));

// 主页
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
              <p>Discover amazing games, earn rewards and achievements</p>
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

              <h2>Popular Games</h2>
              <div class="games-grid">
                  ${Array.from(games.values()).map(game => `
                      <div class="game-card" onclick="location.href='/game/${game.id}'">
                          <div class="game-icon">${game.icon}</div>
                          <h3>${game.name}</h3>
                          <p>${game.description}</p>
                          <p><small>Difficulty: ${game.difficulty}</small></p>
                      </div>
                  `).join('')}
              </div>
          ` : `
              <div style="text-align: center; padding: 4rem 0;">
                  <h2>Please login to start playing</h2>
                  <p style="margin: 2rem 0;">Login to experience all amazing games</p>
                  <a href="/login" class="btn" style="padding: 15px 30px; font-size: 1.1rem;">Login Now</a>
              </div>
          `}
      </div>

      <script>
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
    case 1: // Number Guess
      gameHTML = `
        <div style="text-align: center;">
          <h2>🔢 Number Guess</h2>
          <p>Guess a number between 1-100, you have 7 attempts!</p>
          <div style="margin: 2rem 0;">
            <input type="number" id="guess" min="1" max="100" placeholder="Enter your guess" style="padding: 10px; font-size: 1.2rem;">
            <button onclick="makeGuess()" style="padding: 10px 20px; margin-left: 10px;">Guess!</button>
          </div>
          <div id="result" style="min-height: 100px;"></div>
          <div id="attempts">Attempts left: 7</div>
        </div>
        <script>
          let targetNumber = Math.floor(Math.random() * 100) + 1;
          let attemptsLeft = 7;
          
          function makeGuess() {
            if (attemptsLeft <= 0) {
              showResult('Game over! The number was: ' + targetNumber, 'error');
              return;
            }
            
            const guess = parseInt(document.getElementById('guess').value);
            if (!guess || guess < 1 || guess > 100) {
              showResult('Please enter a number between 1-100', 'error');
              return;
            }
            
            attemptsLeft--;
            document.getElementById('attempts').textContent = 'Attempts left: ' + attemptsLeft;
            
            if (guess === targetNumber) {
              showResult('🎉 Congratulations! You guessed it!', 'success');
              submitGameResult(true, 100);
            } else if (guess < targetNumber) {
              showResult('📈 Too low! Try again', 'info');
            } else {
              showResult('📉 Too high! Try again', 'info');
            }
            
            document.getElementById('guess').value = '';
            document.getElementById('guess').focus();
            
            if (attemptsLeft === 0 && guess !== targetNumber) {
              showResult('😔 Game over! The number was: ' + targetNumber, 'error');
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
      
    case 2: // Memory Cards
      gameHTML = `
        <div style="text-align: center;">
          <h2>🎴 Memory Cards</h2>
          <p>Click cards to find all matching pairs!</p>
          <div id="memory-game" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; max-width: 400px; margin: 2rem auto;"></div>
          <div id="game-info">Matched pairs: 0/8</div>
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
              document.getElementById('game-info').textContent = \`Matched pairs: \${matchedPairs}/8\`;
              flippedCards = [];
              
              if (matchedPairs === 8) {
                setTimeout(() => {
                  showResult('🎉 Congratulations! You completed the game!', 'success');
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
      gameHTML = `<p>Game under development...</p>`;
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
          <a href="/" class="btn">← Back to Home</a>
          <h1>${game.icon} ${game.name}</h1>
          <div>Player: ${user.name}</div>
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
                  console.log('Result submission failed');
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

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.json({ success: false, error: 'Please fill all fields' });
    }
    
    // Check if email exists
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
    
    // Auto login
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
    
    // Find user
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
    
    // Create session
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
        
        // Level up logic
        const newLevel = Math.floor(userData.xp / 100) + 1;
        if (newLevel > userData.level) {
          userData.level = newLevel;
          userData.coins += newLevel * 50; // Level up bonus
        }
      }
      
      // Update session
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

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    users: userCount,
    games: games.size,
    timestamp: Date.now()
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  console.log('⚠️ Exception caught:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('⚠️ Rejection handled at:', promise);
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('🎮 FUNX GAMING PLATFORM');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
  console.log('✅ Games: Number Guess, Memory Cards, More...');
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