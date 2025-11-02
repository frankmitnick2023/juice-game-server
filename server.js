// server.js - 体感榨汁机游戏服务器（优化修复版）
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

console.log('🚀 启动体感榨汁机游戏服务器...');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==================== WIX API 配置 ====================
const WIX_API_BASE = 'https://www.wixapis.com';

// Wix API 工具函数
async function callWixAPI(endpoint, method = 'GET', body = null) {
  const API_KEY = process.env.WIX_API_KEY;
  
  if (!API_KEY) {
    console.error('❌ WIX_API_KEY 环境变量未设置');
    throw new Error('WIX_API_KEY 环境变量未设置');
  }
  
  const options = {
    method,
    headers: {
      'Authorization': API_KEY,
      'Content-Type': 'application/json'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    console.log('📡 调用 Wix API:', endpoint);
    const response = await fetch(`${WIX_API_BASE}${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`Wix API 错误: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Wix API 响应成功');
    return data;
  } catch (error) {
    console.error('❌ Wix API 调用失败:', error.message);
    throw error;
  }
}

// 通过邮箱查找 Wix 用户
async function findWixUserByEmail(email) {
  try {
    console.log('🔍 查找 Wix 用户:', email);
    
    const membersResult = await callWixAPI('/members/v1/members', 'GET');
    
    if (membersResult.members) {
      const member = membersResult.members.find(m => 
        m.loginEmail === email
      );
      if (member) {
        console.log('✅ 找到用户');
        return member;
      }
    }
    
    console.log('❌ 未找到用户');
    return null;
  } catch (error) {
    console.error('查找用户失败:', error.message);
    return null;
  }
}

// 获取所有 Wix 联系人
async function getAllWixContacts() {
  try {
    console.log('📞 获取 Wix 联系人');
    
    const membersResult = await callWixAPI('/members/v1/members', 'GET');
    
    if (membersResult.members) {
      return {
        api: 'members', 
        count: membersResult.members.length,
        items: membersResult.members
      };
    }
    
    return { api: 'none', count: 0, items: [] };
  } catch (error) {
    console.error('获取联系人失败:', error.message);
    return { api: 'error', count: 0, items: [], error: error.message };
  }
}

// ==================== Express 路由 ====================

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '榨汁机服务器运行正常',
    timestamp: new Date().toISOString()
  });
});

// 根路由
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>学校游戏中心</title>
        <style>
          body { font-family: Arial; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; min-height: 100vh; }
          .container { max-width: 500px; margin: 0 auto; background: rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; backdrop-filter: blur(10px); }
          .btn { display: inline-block; padding: 12px 24px; background: #ff6b6b; color: white; text-decoration: none; border-radius: 8px; margin: 10px; transition: all 0.3s ease; }
          .btn:hover { background: #ff5252; transform: scale(1.05); }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎮 学校游戏中心</h1>
          <p>服务器运行正常</p>
          <div>
            <a href="/health" class="btn">健康检查</a>
            <a href="/lobby" class="btn">进入游戏大厅</a>
          </div>
        </div>
      </body>
    </html>
  `);
});

// 基础 API 路由
app.get('/api/test-wix', (req, res) => {
  const API_KEY = process.env.WIX_API_KEY;
  res.json({
    apiKeyConfigured: !!API_KEY,
    message: API_KEY ? '✅ Wix API Key 已配置' : '❌ Wix API Key 未配置'
  });
});

// Wix 用户登录
app.post('/api/wix-login', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.json({ success: false, error: '请输入邮箱' });
  }
  
  try {
    const wixUser = await findWixUserByEmail(email);
    
    if (wixUser) {
      res.json({
        success: true,
        user: {
          id: wixUser.id,
          email: wixUser.loginEmail,
          name: wixUser.contact?.firstName || '用户'
        },
        message: '登录成功'
      });
    } else {
      res.json({ 
        success: false, 
        error: '邮箱未注册' 
      });
    }
  } catch (error) {
    res.json({ 
      success: false, 
      error: '系统错误' 
    });
  }
});

// 获取联系人
app.get('/api/wix-contacts', async (req, res) => {
  try {
    const result = await getAllWixContacts();
    
    if (result.error) {
      return res.json({ 
        success: false, 
        error: result.error
      });
    }
    
    res.json({ 
      success: true, 
      count: result.count,
      users: result.items.slice(0, 5).map(u => ({ 
        id: u.id, 
        email: u.loginEmail,
        name: u.contact?.firstName || '未知'
      }))
    });
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== Socket.IO 游戏逻辑 ====================

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 存储游戏数据
const gameRooms = new Map();
const players = new Map();

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('🔗 玩家连接:', socket.id);

  socket.on('join_game', (playerData) => {
    const { username, email } = playerData;
    console.log(`👤 玩家加入: ${username}`);
    
    players.set(socket.id, {
      id: socket.id,
      username: username,
      email: email,
      room: null,
      score: 0
    });

    socket.emit('joined_success', {
      message: '加入游戏成功',
      playerId: socket.id
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ 玩家断开: ${socket.id}`);
    players.delete(socket.id);
  });

  socket.on('ping', () => {
    socket.emit('pong', { time: new Date().toISOString() });
  });
});

// ==================== 游戏页面路由 ====================

// 游戏大厅
app.get('/lobby', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>游戏大厅 - 舞蹈学校</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Arial', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; padding: 20px; }
            .header h1 { font-size: 3em; margin-bottom: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
            .user-info {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                margin-bottom: 30px;
                backdrop-filter: blur(10px);
            }
            .games-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 25px;
                margin: 30px 0;
            }
            .game-card {
                background: rgba(255,255,255,0.1);
                border-radius: 20px;
                padding: 30px;
                text-align: center;
                backdrop-filter: blur(10px);
                border: 2px solid rgba(255,255,255,0.2);
                transition: all 0.3s ease;
                cursor: pointer;
            }
            .game-card:hover {
                transform: translateY(-10px);
                background: rgba(255,255,255,0.15);
                border-color: #ff6b6b;
            }
            .game-icon { font-size: 4em; margin-bottom: 20px; }
            .game-title { font-size: 1.5em; font-weight: bold; margin-bottom: 10px; }
            .game-description { opacity: 0.8; margin-bottom: 20px; line-height: 1.5; }
            .btn {
                padding: 12px 30px;
                background: #ff6b6b;
                color: white;
                border: none;
                border-radius: 10px;
                font-size: 1.1em;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                transition: all 0.3s ease;
            }
            .btn:hover { background: #ff5252; transform: scale(1.05); }
            .btn-back { background: #6c757d; }
            .btn-back:hover { background: #5a6268; }
            .coming-soon { opacity: 0.6; }
            .coming-soon .btn { background: #6c757d; cursor: not-allowed; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎮 游戏大厅</h1>
                <p>选择你想玩的游戏</p>
            </div>

            <div class="user-info">
                <div id="userWelcome">欢迎来到游戏大厅！请先登录。</div>
                <div style="margin-top: 10px;">
                    <button onclick="simulateLogin()" class="btn">测试登录</button>
                </div>
            </div>

            <div class="games-grid">
                <div class="game-card" onclick="startGame('juice-maker')">
                    <div class="game-icon">🍹</div>
                    <div class="game-title">体感榨汁机</div>
                    <div class="game-description">
                        通过体感操作摇晃设备来制作果汁！<br>
                        与朋友比赛看谁榨的果汁更多！
                    </div>
                    <button class="btn">开始游戏</button>
                </div>

                <div class="game-card coming-soon">
                    <div class="game-icon">💃</div>
                    <div class="game-title">节奏舞蹈</div>
                    <div class="game-description">
                        跟随节奏舞动！<br>
                        匹配舞蹈动作获得高分！
                    </div>
                    <button class="btn">即将推出</button>
                </div>

                <div class="game-card coming-soon">
                    <div class="game-icon">🎵</div>
                    <div class="game-title">音乐记忆</div>
                    <div class="game-description">
                        记忆音乐序列！<br>
                        测试你的音乐记忆能力！
                    </div>
                    <button class="btn">即将推出</button>
                </div>
            </div>

            <div style="text-align: center; margin-top: 40px;">
                <a href="/" class="btn btn-back">🏠 返回首页</a>
            </div>
        </div>

        <script>
            function simulateLogin() {
                const testUser = {
                    name: '测试玩家',
                    email: 'test@example.com',
                    id: 'test-' + Date.now()
                };
                localStorage.setItem('game_user', JSON.stringify(testUser));
                localStorage.setItem('game_logged_in', 'true');
                document.getElementById('userWelcome').textContent = 
                    '欢迎 ' + testUser.name + ' 来到游戏大厅！';
            }

            function startGame(gameType) {
                if (gameType === 'juice-maker') {
                    window.location.href = '/game/juice-maker';
                }
            }

            // 检查是否有已登录用户
            const userData = localStorage.getItem('game_user');
            if (userData) {
                const user = JSON.parse(userData);
                document.getElementById('userWelcome').textContent = 
                    '欢迎 ' + user.name + ' 来到游戏大厅！';
            }
        </script>
    </body>
    </html>
  `);
});

// 体感榨汁机游戏页面
app.get('/game/juice-maker', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>体感榨汁机 - 游戏中</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Arial', sans-serif;
                background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%);
                color: white;
                min-height: 100vh;
                padding: 20px;
            }
            .game-container { max-width: 800px; margin: 0 auto; text-align: center; }
            .header { margin-bottom: 30px; }
            .header h1 { font-size: 2.5em; margin-bottom: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
            .game-area {
                background: rgba(255,255,255,0.1);
                padding: 40px;
                border-radius: 20px;
                margin: 20px 0;
                backdrop-filter: blur(10px);
            }
            .juice-machine {
                width: 200px;
                height: 300px;
                background: #e17055;
                border-radius: 20px;
                margin: 0 auto 30px;
                position: relative;
                border: 5px solid #d63031;
                overflow: hidden;
            }
            .juice-level {
                position: absolute;
                bottom: 0;
                width: 100%;
                background: linear-gradient(to top, #e17055, #fd79a8);
                transition: height 0.5s ease;
                border-radius: 15px 15px 0 0;
            }
            .game-stats {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 15px;
                margin: 30px 0;
            }
            .stat-item {
                background: rgba(255,255,255,0.15);
                padding: 20px;
                border-radius: 15px;
            }
            .stat-value {
                font-size: 2em;
                font-weight: bold;
                color: #ffeaa7;
            }
            .controls { margin: 30px 0; }
            .btn {
                padding: 15px 30px;
                background: #00b894;
                color: white;
                border: none;
                border-radius: 10px;
                font-size: 1.2em;
                cursor: pointer;
                margin: 10px;
                text-decoration: none;
                display: inline-block;
                transition: all 0.3s ease;
            }
            .btn:hover { background: #00a085; transform: scale(1.05); }
            .btn-back { background: #6c5ce7; }
            .instructions {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                margin: 20px 0;
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="game-container">
            <div class="header">
                <h1>🍹 体感榨汁机</h1>
                <p>摇晃你的设备来制作果汁！</p>
            </div>

            <div class="game-area">
                <div class="juice-machine">
                    <div class="juice-level" id="juiceLevel" style="height: 0%;"></div>
                </div>

                <div class="game-stats">
                    <div class="stat-item">
                        <div class="stat-value" id="currentScore">0</div>
                        <div>当前分数</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="timeLeft">60</div>
                        <div>剩余时间</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="bestScore">0</div>
                        <div>最高分数</div>
                    </div>
                </div>

                <div class="controls">
                    <button class="btn" onclick="startGame()">🎯 开始游戏</button>
                    <button class="btn" onclick="resetGame()">🔄 重新开始</button>
                </div>

                <div class="instructions">
                    <h3>🎮 游戏说明：</h3>
                    <ul>
                        <li>点击"开始游戏"按钮开始</li>
                        <li>摇晃你的手机或设备来榨汁</li>
                        <li>在60秒内获得尽可能高的分数</li>
                        <li>果汁越多，分数越高！</li>
                    </ul>
                </div>
            </div>

            <div>
                <a href="/lobby" class="btn btn-back">← 返回游戏大厅</a>
                <a href="/" class="btn btn-back">🏠 返回首页</a>
            </div>
        </div>

        <script>
            let gameActive = false;
            let score = 0;
            let timeLeft = 60;
            let gameTimer;
            let shakeInterval;

            function startGame() {
                if (gameActive) return;
                
                gameActive = true;
                score = 0;
                timeLeft = 60;
                
                updateDisplay();
                startTimer();
                setupMotionDetection();
            }

            function resetGame() {
                gameActive = false;
                clearInterval(gameTimer);
                clearInterval(shakeInterval);
                score = 0;
                timeLeft = 60;
                document.getElementById('juiceLevel').style.height = '0%';
                updateDisplay();
            }

            function startTimer() {
                clearInterval(gameTimer);
                gameTimer = setInterval(() => {
                    timeLeft--;
                    updateDisplay();
                    
                    if (timeLeft <= 0) {
                        endGame();
                    }
                }, 1000);
            }

            function setupMotionDetection() {
                clearInterval(shakeInterval);
                
                // 使用 DeviceMotion API 检测摇晃
                if (window.DeviceMotionEvent) {
                    let lastShake = Date.now();
                    
                    window.addEventListener('devicemotion', handleMotion);
                    
                    // 同时设置备用计时器
                    shakeInterval = setInterval(() => {
                        if (!gameActive) {
                            clearInterval(shakeInterval);
                            window.removeEventListener('devicemotion', handleMotion);
                        }
                    }, 1000);
                } else {
                    // 备用方案：点击增加分数
                    document.addEventListener('click', handleClick);
                }
            }

            function handleMotion(event) {
                if (!gameActive) return;
                
                const acceleration = event.accelerationIncludingGravity;
                const shakeThreshold = 15;
                
                if (acceleration) {
                    const totalForce = Math.abs(acceleration.x) + Math.abs(acceleration.y) + Math.abs(acceleration.z);
                    
                    if (totalForce > shakeThreshold && Date.now() - lastShake > 300) {
                        addScore(10);
                        lastShake = Date.now();
                    }
                }
            }

            function handleClick() {
                if (!gameActive) return;
                addScore(5);
            }

            function addScore(points) {
                score += points;
                const juiceLevel = Math.min(100, (score / 500) * 100);
                document.getElementById('juiceLevel').style.height = juiceLevel + '%';
                updateDisplay();
            }

            function updateDisplay() {
                document.getElementById('currentScore').textContent = score;
                document.getElementById('timeLeft').textContent = timeLeft;
                
                const bestScore = localStorage.getItem('juice_maker_best_score') || 0;
                document.getElementById('bestScore').textContent = bestScore;
            }

            function endGame() {
                gameActive = false;
                clearInterval(gameTimer);
                clearInterval(shakeInterval);
                
                const bestScore = parseInt(localStorage.getItem('juice_maker_best_score') || 0);
                if (score > bestScore) {
                    localStorage.setItem('juice_maker_best_score', score);
                }
                
                alert('游戏结束！你的得分: ' + score);
                
                // 清理事件监听器
                window.removeEventListener('devicemotion', handleMotion);
                document.removeEventListener('click', handleClick);
            }

            // 初始化显示
            updateDisplay();
        </script>
    </body>
    </html>
  `);
});

// ==================== 服务器启动 ====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=================================');
  console.log('🎮 体感榨汁机游戏服务器已启动!');
  console.log(`📍 端口: ${PORT}`);
  console.log(`🌐 健康检查: http://localhost:${PORT}/health`);
  console.log('=================================');
});

// 全局错误处理
process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 拒绝:', error);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});