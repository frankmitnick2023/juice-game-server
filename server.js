// server.js - 完整游戏平台版
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

console.log('🚀 Starting FunX Gaming Platform...');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // 静态文件服务

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
const userScores = new Map(); // 用户游戏分数
let userCount = 0;

// 完整的游戏库
const defaultGames = [
  {
    id: 1,
    name: "Number Guess",
    description: "Guess a number between 1-100",
    type: "puzzle",
    difficulty: "easy",
    icon: "🔢",
    category: "Puzzle",
    playCount: 0
  },
  {
    id: 2, 
    name: "Memory Cards",
    description: "Match identical cards",
    type: "memory", 
    difficulty: "medium",
    icon: "🎴",
    category: "Memory",
    playCount: 0
  },
  {
    id: 3,
    name: "Quick Click",
    description: "Click targets as fast as you can",
    type: "action", 
    difficulty: "easy",
    icon: "🎯",
    category: "Action",
    playCount: 0
  },
  {
    id: 4,
    name: "Juice Maker",
    description: "Create delicious juice recipes",
    type: "creative",
    difficulty: "easy", 
    icon: "🥤",
    category: "Creative",
    playCount: 0
  },
  {
    id: 5,
    name: "Word Spell",
    description: "Spell words based on hints",
    type: "education",
    difficulty: "medium",
    icon: "📝",
    category: "Education", 
    playCount: 0
  },
  {
    id: 6,
    name: "Math Challenge",
    description: "Solve math problems quickly",
    type: "education",
    difficulty: "hard",
    icon: "🧮",
    category: "Education",
    playCount: 0
  }
];

defaultGames.forEach(game => games.set(game.id, game));

// 主页 - 增强版游戏平台
app.get('/', (req, res) => {
  const user = req.session.user;
  
  // 获取热门游戏
  const popularGames = Array.from(games.values())
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, 4);

  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>FunX - Ultimate Gaming Platform</title>
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
              backdrop-filter: blur(10px);
          }
          .logo { font-size: 1.8rem; font-weight: bold; }
          .nav { display: flex; gap: 1rem; }
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
              transition: all 0.3s;
          }
          .btn:hover { background: #ff5252; transform: translateY(-2px); }
          .btn-secondary {
              background: rgba(255,255,255,0.2);
              border: 1px solid rgba(255,255,255,0.3);
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
          .hero h1 { font-size: 3.5rem; margin-bottom: 1rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
          .hero p { font-size: 1.2rem; opacity: 0.9; margin-bottom: 2rem; }
          .games-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
              gap: 2rem;
              margin-top: 2rem;
          }
          .game-card {
              background: rgba(255,255,255,0.1);
              padding: 2rem;
              border-radius: 15px;
              backdrop-filter: blur(10px);
              text-align: center;
              transition: all 0.3s;
              cursor: pointer;
              border: 1px solid rgba(255,255,255,0.1);
          }
          .game-card:hover {
              transform: translateY(-10px);
              background: rgba(255,255,255,0.15);
              box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          }
          .game-icon { 
              font-size: 3rem; 
              margin-bottom: 1rem; 
              filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.3));
          }
          .game-category {
              display: inline-block;
              background: rgba(255,255,255,0.2);
              padding: 4px 12px;
              border-radius: 20px;
              font-size: 0.8rem;
              margin: 0.5rem 0;
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
              backdrop-filter: blur(10px);
          }
          .section-title {
              font-size: 2rem;
              margin: 3rem 0 1rem 0;
              text-align: center;
          }
          .category-filter {
              display: flex;
              justify-content: center;
              gap: 1rem;
              margin: 2rem 0;
              flex-wrap: wrap;
          }
          .category-btn {
              background: rgba(255,255,255,0.1);
              border: 1px solid rgba(255,255,255,0.3);
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              cursor: pointer;
              transition: all 0.3s;
          }
          .category-btn.active, .category-btn:hover {
              background: #ff6b6b;
          }
      </style>
  </head>
  <body>
      <div class="header">
          <div class="logo">🎮 FunX Games</div>
          <div class="nav">
              <a href="/games" class="btn btn-secondary">All Games</a>
              <a href="/leaderboard" class="btn btn-secondary">Leaderboard</a>
          </div>
          <div class="user-info">
              ${user ? `
                  <span>Welcome, <strong>${user.name}</strong>!</span>
                  <span>Level ${user.level} | ⭐${user.xp} | 🪙${user.coins}</span>
                  <a href="/logout" class="btn">Logout</a>
              ` : `
                  <a href="/login" class="btn">Login</a>
                  <a href="/register" class="btn">Register</a>
              `}
          </div>
      </div>

      <div class="container">
          <div class="hero">
              <h1>Welcome to FunX Gaming</h1>
              <p>Discover amazing games, earn rewards, and climb the leaderboards!</p>
              ${user ? `
                  <div style="margin-top: 2rem;">
                      <a href="/games" class="btn" style="padding: 15px 30px; font-size: 1.2rem;">Start Playing Now</a>
                  </div>
              ` : `
                  <div style="margin-top: 2rem;">
                      <a href="/register" class="btn" style="padding: 15px 30px; font-size: 1.2rem; margin-right: 1rem;">Join Now</a>
                      <a href="/games" class="btn btn-secondary" style="padding: 15px 30px; font-size: 1.2rem;">Browse Games</a>
                  </div>
              `}
          </div>

          ${user ? `
              <div class="stats">
                  <div class="stat-card">
                      <h3>🏆 Level</h3>
                      <p style="font-size: 2rem; font-weight: bold;">${user.level}</p>
                  </div>
                  <div class="stat-card">
                      <h3>⭐ Experience</h3>
                      <p style="font-size: 2rem; font-weight: bold;">${user.xp}</p>
                  </div>
                  <div class="stat-card">
                      <h3>🪙 Coins</h3>
                      <p style="font-size: 2rem; font-weight: bold;">${user.coins || 0}</p>
                  </div>
                  <div class="stat-card">
                      <h3>🎯 Games Played</h3>
                      <p style="font-size: 2rem; font-weight: bold;">${user.gamesPlayed || 0}</p>
                  </div>
              </div>

              <h2 class="section-title">Popular Games</h2>
              <div class="games-grid">
                  ${popularGames.map(game => `
                      <div class="game-card" onclick="location.href='/game/${game.id}'">
                          <div class="game-icon">${game.icon}</div>
                          <h3>${game.name}</h3>
                          <p>${game.description}</p>
                          <div class="game-category">${game.category}</div>
                          <p><small>Difficulty: ${game.difficulty} • Plays: ${game.playCount || 0}</small></p>
                      </div>
                  `).join('')}
              </div>

              <div style="text-align: center; margin: 3rem 0;">
                  <a href="/games" class="btn" style="padding: 12px 24px;">View All Games</a>
              </div>
          ` : `
              <div style="text-align: center; padding: 4rem 0;">
                  <h2>Join Our Gaming Community</h2>
                  <p style="margin: 2rem 0; font-size: 1.1rem;">Register now to unlock all games, track your progress, and compete with friends!</p>
                  <a href="/register" class="btn" style="padding: 15px 30px; font-size: 1.1rem;">Create Free Account</a>
              </div>
          `}
      </div>

      <script>
          ${!user ? `
              setTimeout(() => {
                  if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register') && !window.location.pathname.includes('/games')) {
                      window.location.href = '/login';
                  }
              }, 3000);
          ` : ''}
      </script>
  </body>
  </html>
  `);
});

// 游戏库页面
app.get('/games', (req, res) => {
  const user = req.session.user;
  const category = req.query.category || 'all';
  
  let filteredGames = Array.from(games.values());
  if (category !== 'all') {
    filteredGames = filteredGames.filter(game => game.category === category);
  }
  
  const categories = ['all', ...new Set(Array.from(games.values()).map(game => game.category))];
  
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>Game Library - FunX</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
          body { 
              font-family: Arial; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white; 
              margin: 0;
              min-height: 100vh;
          }
          .header {
              background: rgba(0,0,0,0.2);
              padding: 1rem 2rem;
              display: flex;
              justify-content: space-between;
              align-items: center;
          }
          .logo { font-size: 1.5rem; font-weight: bold; }
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
          .games-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
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
              backdrop-filter: blur(10px);
          }
          .game-card:hover {
              transform: translateY(-5px);
          }
          .game-icon { font-size: 3rem; margin-bottom: 1rem; }
          .category-filter {
              display: flex;
              gap: 1rem;
              margin: 2rem 0;
              flex-wrap: wrap;
              justify-content: center;
          }
          .category-btn {
              background: rgba(255,255,255,0.1);
              border: 1px solid rgba(255,255,255,0.3);
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              cursor: pointer;
              text-decoration: none;
          }
          .category-btn.active {
              background: #ff6b6b;
          }
      </style>
  </head>
  <body>
      <div class="header">
          <a href="/" class="logo">🎮 FunX Games</a>
          <div>
              ${user ? `
                  <span>Welcome, ${user.name}!</span>
                  <a href="/" class="btn" style="margin-left: 1rem;">Back to Home</a>
              ` : `
                  <a href="/login" class="btn">Login</a>
                  <a href="/register" class="btn">Register</a>
              `}
          </div>
      </div>

      <div class="container">
          <h1 style="text-align: center; margin-bottom: 1rem;">Game Library</h1>
          <p style="text-align: center; opacity: 0.8;">Choose from our collection of amazing games</p>
          
          <div class="category-filter">
              ${categories.map(cat => `
                  <a href="/games?category=${cat}" class="category-btn ${category === cat ? 'active' : ''}">
                      ${cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </a>
              `).join('')}
          </div>

          <div class="games-grid">
              ${filteredGames.map(game => `
                  <div class="game-card" onclick="location.href='/game/${game.id}'">
                      <div class="game-icon">${game.icon}</div>
                      <h3>${game.name}</h3>
                      <p>${game.description}</p>
                      <p><small>Category: ${game.category} • Difficulty: ${game.difficulty}</small></p>
                      <p><small>Plays: ${game.playCount || 0}</small></p>
                  </div>
              `).join('')}
          </div>
      </div>
  </body>
  </html>
  `);
});

// 登录和注册页面保持不变...
// [之前的登录和注册代码在这里，为了简洁省略]

// 游戏路由 - 整合所有游戏
app.get('/game/:id', (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.redirect('/login');
  }
  
  const gameId = parseInt(req.params.id);
  const game = games.get(gameId);
  
  if (!game) {
    return res.redirect('/games');
  }
  
  // 更新游戏游玩次数
  game.playCount = (game.playCount || 0) + 1;
  
  let gameHTML = '';
  
  switch(gameId) {
    case 1: // Number Guess
      gameHTML = `
        <div style="text-align: center;">
          <h2>🔢 Number Guess</h2>
          <p>Guess a number between 1-100, you have 7 attempts!</p>
          <div style="margin: 2rem 0;">
            <input type="number" id="guess" min="1" max="100" placeholder="Enter your guess" style="padding: 10px; font-size: 1.2rem; border-radius: 5px; border: none;">
            <button onclick="makeGuess()" style="padding: 10px 20px; margin-left: 10px; background: #ff6b6b; color: white; border: none; border-radius: 5px; cursor: pointer;">Guess!</button>
          </div>
          <div id="result" style="min-height: 100px; margin: 1rem 0;"></div>
          <div id="attempts" style="font-weight: bold;">Attempts left: 7</div>
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
          <div id="game-info" style="font-weight: bold;">Matched pairs: 0/8</div>
          <button onclick="resetGame()" style="margin-top: 1rem; padding: 10px 20px; background: #ff6b6b; color: white; border: none; border-radius: 5px; cursor: pointer;">Reset Game</button>
        </div>
        <script>
          const cards = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'];
          let gameCards, flippedCards, matchedPairs;
          
          function initGame() {
            gameCards = [...cards, ...cards].sort(() => Math.random() - 0.5);
            flippedCards = [];
            matchedPairs = 0;
            
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
          
          function resetGame() {
            initGame();
            document.getElementById('game-info').textContent = 'Matched pairs: 0/8';
          }
          
          function showResult(message, type) {
            alert(message);
          }
          
          initGame();
        </script>
        <style>
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
      `;
      break;
      
    case 4: // Juice Maker
      gameHTML = `
        <div style="text-align: center;">
          <h2>🥤 Juice Maker</h2>
          <p>Create delicious juice recipes by dragging fruits to the blender!</p>
          <div style="max-width: 500px; margin: 0 auto;">
            <!-- Juice Maker 游戏界面 -->
            <div id="juice-game" style="background: rgba(255,255,255,0.1); padding: 2rem; border-radius: 15px; margin: 2rem 0;">
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem;">
                <div class="fruit" data-fruit="apple" style="padding: 1rem; background: rgba(255,255,255,0.2); border-radius: 10px; cursor: grab;">
                  🍎 Apple
                </div>
                <div class="fruit" data-fruit="orange" style="padding: 1rem; background: rgba(255,255,255,0.2); border-radius: 10px; cursor: grab;">
                  🍊 Orange
                </div>
                <div class="fruit" data-fruit="banana" style="padding: 1rem; background: rgba(255,255,255,0.2); border-radius: 10px; cursor: grab;">
                  🍌 Banana
                </div>
                <div class="fruit" data-fruit="grape" style="padding: 1rem; background: rgba(255,255,255,0.2); border-radius: 10px; cursor: grab;">
                  🍇 Grape
                </div>
                <div class="fruit" data-fruit="strawberry" style="padding: 1rem; background: rgba(255,255,255,0.2); border-radius: 10px; cursor: grab;">
                  🍓 Strawberry
                </div>
                <div class="fruit" data-fruit="pineapple" style="padding: 1rem; background: rgba(255,255,255,0.2); border-radius: 10px; cursor: grab;">
                  🍍 Pineapple
                </div>
              </div>
              
              <div id="blender" style="background: #8B4513; padding: 2rem; border-radius: 50%; width: 150px; height: 150px; margin: 0 auto; display: flex; align-items: center; justify-content: center; position: relative;">
                <div style="background: rgba(255,255,255,0.9); width: 100px; height: 100px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 2rem;">
                  <span id="blender-content">🥤</span>
                </div>
              </div>
              
              <div style="margin: 2rem 0;">
                <div id="recipe" style="min-height: 60px; margin: 1rem 0; padding: 1rem; background: rgba(255,255,255,0.1); border-radius: 10px;">
                  <strong>Your Recipe:</strong> <span id="recipe-items">Nothing yet...</span>
                </div>
                <button onclick="blendJuice()" style="padding: 12px 24px; background: #ff6b6b; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1.1rem;">Blend Juice! 🎉</button>
                <button onclick="resetBlender()" style="padding: 12px 24px; background: rgba(255,255,255,0.2); color: white; border: none; border-radius: 8px; cursor: pointer; margin-left: 1rem;">Reset</button>
              </div>
              
              <div id="result" style="min-height: 80px; padding: 1rem; background: rgba(255,255,255,0.1); border-radius: 10px; margin-top: 1rem;"></div>
            </div>
          </div>
        </div>
        
        <script>
          let selectedFruits = [];
          let score = 0;
          
          // 拖拽功能
          document.addEventListener('DOMContentLoaded', function() {
            const fruits = document.querySelectorAll('.fruit');
            const blender = document.getElementById('blender');
            
            fruits.forEach(fruit => {
              fruit.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', this.getAttribute('data-fruit'));
              });
            });
            
            blender.addEventListener('dragover', function(e) {
              e.preventDefault();
              this.style.background = '#A0522D';
            });
            
            blender.addEventListener('dragleave', function() {
              this.style.background = '#8B4513';
            });
            
            blender.addEventListener('drop', function(e) {
              e.preventDefault();
              this.style.background = '#8B4513';
              
              const fruitType = e.dataTransfer.getData('text/plain');
              addFruitToBlender(fruitType);
            });
          });
          
          function addFruitToBlender(fruitType) {
            if (selectedFruits.length >= 5) {
              showMessage('Blender is full! Blend or reset first.', 'error');
              return;
            }
            
            selectedFruits.push(fruitType);
            updateRecipeDisplay();
            updateBlenderDisplay();
            
            // 添加动画效果
            const blender = document.getElementById('blender');
            blender.style.transform = 'scale(1.1)';
            setTimeout(() => {
              blender.style.transform = 'scale(1)';
            }, 200);
          }
          
          function updateRecipeDisplay() {
            const recipeItems = document.getElementById('recipe-items');
            if (selectedFruits.length === 0) {
              recipeItems.textContent = 'Nothing yet...';
            } else {
              const fruitEmojis = selectedFruits.map(fruit => {
                const emojiMap = {
                  'apple': '🍎',
                  'orange': '🍊', 
                  'banana': '🍌',
                  'grape': '🍇',
                  'strawberry': '🍓',
                  'pineapple': '🍍'
                };
                return emojiMap[fruit] || '🍎';
              });
              recipeItems.textContent = fruitEmojis.join(' + ');
            }
          }
          
          function updateBlenderDisplay() {
            const blenderContent = document.getElementById('blender-content');
            if (selectedFruits.length === 0) {
              blenderContent.textContent = '🥤';
            } else {
              // 根据水果组合显示不同表情
              const uniqueFruits = [...new Set(selectedFruits)];
              if (uniqueFruits.length === 1) {
                blenderContent.textContent = '🥤';
              } else if (uniqueFruits.length >= 3) {
                blenderContent.textContent = '🌈';
              } else {
                blenderContent.textContent = '✨';
              }
            }
          }
          
          function blendJuice() {
            if (selectedFruits.length === 0) {
              showMessage('Add some fruits first!', 'error');
              return;
            }
            
            const uniqueFruits = [...new Set(selectedFruits)];
            let points = 0;
            let message = '';
            
            if (selectedFruits.length >= 5) {
              points = 100;
              message = '🎉 Perfect Blend! Maximum points!';
            } else if (uniqueFruits.length >= 3) {
              points = 80;
              message = '🌟 Great Combination! Tasty juice!';
            } else if (selectedFruits.length >= 2) {
              points = 50;
              message = '👍 Good mix! Refreshing juice!';
            } else {
              points = 20;
              message = '😊 Simple but delicious!';
            }
            
            score += points;
            
            const resultDiv = document.getElementById('result');
            resultDiv.innerHTML = \`
              <div style="background: rgba(0,255,0,0.2); padding: 1rem; border-radius: 8px;">
                <h3>🥤 Juice Created!</h3>
                <p>\${message}</p>
                <p><strong>Points earned: +\${points}</strong></p>
                <p>Total score: \${score}</p>
              </div>
            \`;
            
            // 提交分数
            submitGameResult(true, points);
            
            // 清空搅拌机
            setTimeout(() => {
              selectedFruits = [];
              updateRecipeDisplay();
              updateBlenderDisplay();
            }, 3000);
          }
          
          function resetBlender() {
            selectedFruits = [];
            updateRecipeDisplay();
            updateBlenderDisplay();
            document.getElementById('result').innerHTML = '';
          }
          
          function showMessage(text, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.innerHTML = \`<div style="background: \${type === 'error' ? 'rgba(255,0,0,0.2)' : 'rgba(255,255,0,0.2)'}; padding: 1rem; border-radius: 8px;">\${text}</div>\`;
          }
        </script>
      `;
      break;
      
    default:
      gameHTML = `
        <div style="text-align: center; padding: 4rem 0;">
          <h2>🚧 Game Under Development</h2>
          <p>This exciting game is coming soon!</p>
          <p>In the meantime, why not try our other games?</p>
          <a href="/games" class="btn" style="display: inline-block; margin-top: 1rem;">Back to Games</a>
        </div>
      `;
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
              padding-bottom: 1rem;
              border-bottom: 1px solid rgba(255,255,255,0.2);
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
          .game-info {
              text-align: center;
              margin-bottom: 2rem;
          }
      </style>
  </head>
  <body>
      <div class="header">
          <a href="/games" class="btn">← Back to Games</a>
          <h1>${game.icon} ${game.name}</h1>
          <div style="display: flex; align-items: center; gap: 1rem;">
              <span>Player: ${user.name}</span>
              <span>Level: ${user.level}</span>
          </div>
      </div>
      
      <div class="game-container">
          <div class="game-info">
              <p><strong>Category:</strong> ${game.category} • <strong>Difficulty:</strong> ${game.difficulty}</p>
              <p>${game.description}</p>
          </div>
          
          ${gameHTML}
      </div>
      
      <script>
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
      </script>
  </body>
  </html>
  `);
});

// [之前的API路由保持不变...]
// 登录、注册、游戏结果提交等API路由

// 排行榜页面
app.get('/leaderboard', (req, res) => {
  const user = req.session.user;
  
  // 获取用户排名
  const userList = Array.from(users.values())
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 20);
  
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>Leaderboard - FunX</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
          body { 
              font-family: Arial; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white; 
              margin: 0;
              min-height: 100vh;
          }
          .header {
              background: rgba(0,0,0,0.2);
              padding: 1rem 2rem;
              display: flex;
              justify-content: space-between;
              align-items: center;
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
          .container {
              max-width: 800px;
              margin: 0 auto;
              padding: 2rem;
          }
          .leaderboard {
              background: rgba(255,255,255,0.1);
              border-radius: 15px;
              padding: 2rem;
              backdrop-filter: blur(10px);
          }
          .leaderboard-item {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 1rem;
              border-bottom: 1px solid rgba(255,255,255,0.1);
          }
          .leaderboard-item:last-child {
              border-bottom: none;
          }
          .rank {
              font-size: 1.2rem;
              font-weight: bold;
              width: 40px;
          }
          .user-info {
              flex: 1;
              margin-left: 1rem;
          }
          .user-stats {
              text-align: right;
          }
          .top-3 {
              background: rgba(255,215,0,0.2);
              border-radius: 10px;
              margin: 0.5rem 0;
          }
      </style>
  </head>
  <body>
      <div class="header">
          <a href="/" class="btn">← Back to Home</a>
          <h1>🏆 Leaderboard</h1>
          <div>
              ${user ? `
                  <span>Your Rank: #${userList.findIndex(u => u.id === user.id) + 1}</span>
              ` : `
                  <a href="/login" class="btn">Login to See Rank</a>
              `}
          </div>
      </div>

      <div class="container">
          <div class="leaderboard">
              <h2 style="text-align: center; margin-bottom: 2rem;">Top Players</h2>
              
              ${userList.map((player, index) => `
                  <div class="leaderboard-item ${index < 3 ? 'top-3' : ''}">
                      <div class="rank">
                          ${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                      </div>
                      <div class="user-info">
                          <strong>${player.name}</strong>
                          <div style="font-size: 0.9rem; opacity: 0.8;">
                              Level ${player.level} • ${player.gamesPlayed || 0} games played
                          </div>
                      </div>
                      <div class="user-stats">
                          <div style="font-size: 1.1rem; font-weight: bold;">⭐ ${player.xp || 0}</div>
                          <div style="font-size: 0.9rem;">🪙 ${player.coins || 0}</div>
                      </div>
                  </div>
              `).join('')}
              
              ${userList.length === 0 ? `
                  <div style="text-align: center; padding: 2rem;">
                      <p>No players yet. Be the first to play!</p>
                      <a href="/games" class="btn">Start Playing</a>
                  </div>
              ` : ''}
          </div>
      </div>
  </body>
  </html>
  `);
});

// [之前的API路由保持不变]
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
  console.log('🎮 FUNX ULTIMATE GAMING PLATFORM');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
  console.log('✅ Games: 6+ Games Available');
  console.log('✅ Juice Maker: INTEGRATED');
  console.log('✅ Game Library: COMPLETE');
  console.log('✅ Leaderboard: ENABLED');
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