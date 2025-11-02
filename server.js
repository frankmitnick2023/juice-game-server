// server.js - 体感榨汁机游戏服务器（完整版 - 包含手机游戏）
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

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
          body { 
            font-family: Arial; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            min-height: 100vh; 
            margin: 0;
          }
          .container { 
            max-width: 500px; 
            margin: 0 auto; 
            background: rgba(255,255,255,0.1); 
            padding: 40px; 
            border-radius: 20px; 
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          }
          .btn { 
            display: inline-block; 
            padding: 15px 30px; 
            background: #ff6b6b; 
            color: white; 
            text-decoration: none; 
            border-radius: 10px; 
            margin: 10px; 
            transition: all 0.3s ease; 
            font-size: 16px;
            border: none;
            cursor: pointer;
          }
          .btn:hover { 
            background: #ff5252; 
            transform: scale(1.05); 
          }
          .btn-mobile {
            background: #4ecdc4;
          }
          .btn-mobile:hover {
            background: #26a69a;
          }
          .game-options {
            display: flex;
            flex-direction: column;
            gap: 15px;
            margin: 30px 0;
          }
          h1 {
            font-size: 2.5em;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
          }
          .version-badge {
            background: rgba(255,255,255,0.2);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8em;
            margin-left: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎮 学校游戏中心</h1>
          <p>选择游戏版本开始体验</p>
          
          <div class="game-options">
            <a href="/lobby" class="btn">进入游戏大厅</a>
            <a href="/game/juice-maker" class="btn">体感榨汁机（基础版）</a>
            <a href="/game/juice-maker-mobile" class="btn btn-mobile">
              体感榨汁机 <span class="version-badge">手机体感版</span>
            </a>
            <a href="/health" class="btn">服务器状态</a>
          </div>
          
          <div style="margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">
            <h3>📱 手机体感版特色</h3>
            <p>• MediaPipe 姿态检测技术</p>
            <p>• 实时骨架追踪</p>
            <p>• 腰部和胯部扭转控制</p>
            <p>• 视频录制分享功能</p>
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
            .btn-mobile {
                background: #4ecdc4;
            }
            .btn-mobile:hover {
                background: #26a69a;
            }
            .btn-back { background: #6c757d; }
            .btn-back:hover { background: #5a6268; }
            .coming-soon { opacity: 0.6; }
            .coming-soon .btn { background: #6c757d; cursor: not-allowed; }
            .version-badge {
                background: rgba(255,255,255,0.3);
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.7em;
                margin-left: 8px;
            }
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
                <!-- 体感榨汁机基础版 -->
                <div class="game-card" onclick="startGame('juice-maker')">
                    <div class="game-icon">🍹</div>
                    <div class="game-title">体感榨汁机 <span class="version-badge">基础版</span></div>
                    <div class="game-description">
                        通过设备摇晃来制作果汁！<br>
                        简单易上手，适合快速体验
                    </div>
                    <button class="btn">开始游戏</button>
                </div>

                <!-- 体感榨汁机手机版 -->
                <div class="game-card" onclick="startGame('juice-maker-mobile')">
                    <div class="game-icon">📱</div>
                    <div class="game-title">体感榨汁机 <span class="version-badge">手机体感版</span></div>
                    <div class="game-description">
                        使用摄像头进行姿态检测！<br>
                        通过腰部和胯部扭转控制榨汁机
                    </div>
                    <button class="btn btn-mobile">开始游戏</button>
                </div>

                <!-- 节奏舞蹈游戏（即将推出） -->
                <div class="game-card coming-soon">
                    <div class="game-icon">💃</div>
                    <div class="game-title">节奏舞蹈</div>
                    <div class="game-description">
                        跟随节奏舞动！<br>
                        匹配舞蹈动作获得高分！
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
                } else if (gameType === 'juice-maker-mobile') {
                    window.location.href = '/game/juice-maker-mobile';
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

// 体感榨汁机基础版游戏页面
app.get('/game/juice-maker', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>体感榨汁机 - 基础版</title>
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
            .version-info {
                background: rgba(255,255,255,0.15);
                padding: 10px;
                border-radius: 8px;
                margin: 10px 0;
                font-size: 0.9em;
            }
        </style>
    </head>
    <body>
        <div class="game-container">
            <div class="header">
                <h1>🍹 体感榨汁机 - 基础版</h1>
                <p>摇晃你的设备来制作果汁！</p>
            </div>

            <div class="game-area">
                <div class="version-info">
                    💡 提示：想要更好的体感体验？试试 <a href="/game/juice-maker-mobile" style="color: #4ecdc4; text-decoration: none;">手机体感版</a> 使用摄像头进行姿态检测！
                </div>

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
                <a href="/game/juice-maker-mobile" class="btn" style="background: #4ecdc4;">📱 体验手机体感版</a>
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

// 体感榨汁机手机版游戏页面
app.get('/game/juice-maker-mobile', (req, res) => {
  // 直接返回手机版HTML内容
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>MediaPipe体感榨汁机游戏 - 手机版</title>
        <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" crossorigin="anonymous"></script>
        <script src="https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js" crossorigin="anonymous"></script>
        <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js" crossorigin="anonymous"></script>
        <script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js" crossorigin="anonymous"></script>
        <style>
            /* 这里插入完整的手机版CSS样式 */
            ${`
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                -webkit-tap-highlight-color: transparent;
            }
            
            body {
                background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 15px;
                overflow-x: hidden;
            }
            
            header {
                text-align: center;
                margin-bottom: 15px;
                width: 100%;
                max-width: 600px;
            }
            
            h1 {
                font-size: 1.8rem;
                margin-bottom: 8px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
                line-height: 1.2;
            }
            
            .subtitle {
                font-size: 1rem;
                opacity: 0.9;
                margin-bottom: 15px;
            }
            
            .container {
                display: flex;
                flex-direction: column;
                gap: 15px;
                width: 100%;
                max-width: 600px;
            }
            
            .game-area {
                position: relative;
                width: 100%;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
            }
            
            #game {
                width: 100%;
                height: 45vh;
                min-height: 300px;
                background: #0b1226;
                display: block;
            }
            
            .video-container {
                position: absolute;
                top: 10px;
                right: 10px;
                width: 100px;
                height: 75px;
                border-radius: 6px;
                overflow: hidden;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
                border: 2px solid rgba(255, 255, 255, 0.2);
            }
            
            #webcam {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transform: scaleX(-1);
            }
            
            .pose-canvas {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
            }
            
            .control-panel {
                width: 100%;
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border-radius: 12px;
                padding: 20px;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
                display: flex;
                flex-direction: column;
                gap: 15px;
            }
            
            .stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }
            
            .stat-card {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                padding: 12px;
                text-align: center;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            }
            
            .stat-label {
                font-size: 0.8rem;
                opacity: 0.8;
                margin-bottom: 5px;
            }
            
            .stat-value {
                font-size: 1.5rem;
                font-weight: bold;
            }
            
            .energy-bar-container {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                padding: 12px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            }
            
            .energy-label {
                display: flex;
                justify-content: space-between;
                margin-bottom: 6px;
                font-size: 0.9rem;
            }
            
            .energy-bar {
                height: 16px;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                overflow: hidden;
            }
            
            #barEnergy {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #ff9a00, #ff5e00);
                border-radius: 8px;
                transition: width 0.3s ease;
            }
            
            .buttons {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            button {
                padding: 14px;
                border: none;
                border-radius: 10px;
                font-size: 1rem;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            }
            
            #btnCalibrateMain {
                background: linear-gradient(135deg, #9b59b6, #8e44ad);
                color: white;
            }
            
            #btnCalibrateMain:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            }
            
            #btnStart {
                background: linear-gradient(135deg, #00b09b, #96c93d);
                color: white;
            }
            
            #btnStart:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            }
            
            #btnStop {
                background: linear-gradient(135deg, #ff416c, #ff4b2b);
                color: white;
            }
            
            #btnStop:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            }
            
            #btnDownload {
                background: linear-gradient(135deg, #3498db, #2980b9);
                color: white;
                display: none;
            }
            
            #btnDownload:hover:not(:disabled) {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            }
            
            button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none !important;
            }
            
            .hint-box {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 10px;
                padding: 12px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            }
            
            #hint {
                text-align: center;
                line-height: 1.4;
                font-size: 0.9rem;
            }
            
            .instructions {
                margin-top: 15px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 15px;
                max-width: 600px;
                width: 100%;
            }
            
            .instructions h2 {
                margin-bottom: 12px;
                text-align: center;
                font-size: 1.2rem;
            }
            
            .instructions ul {
                list-style-position: inside;
                padding-left: 8px;
            }
            
            .instructions li {
                margin-bottom: 8px;
                line-height: 1.4;
                font-size: 0.9rem;
            }
            
            .bad {
                color: #ff6b6b;
            }
            
            .ok {
                color: #4ecdc4;
            }
            
            .prompt {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.7);
                padding: 15px 20px;
                border-radius: 8px;
                text-align: center;
                font-size: 1rem;
                color: #ffcc00;
                z-index: 10;
                animation: pulse 2s infinite;
                display: none;
                max-width: 80%;
            }
            
            .calibration-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 100;
                display: none;
                padding: 20px;
            }
            
            .calibration-content {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                border-radius: 12px;
                padding: 20px;
                width: 100%;
                max-width: 400px;
                text-align: center;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.5);
            }
            
            .calibration-title {
                font-size: 1.4rem;
                margin-bottom: 15px;
                color: #ffcc00;
            }
            
            .calibration-steps {
                text-align: left;
                margin: 15px 0;
                line-height: 1.5;
            }
            
            .calibration-steps li {
                margin-bottom: 8px;
            }
            
            .calibration-progress {
                width: 100%;
                height: 8px;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                margin: 15px 0;
                overflow: hidden;
            }
            
            .calibration-progress-bar {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #00b09b, #96c93d);
                border-radius: 4px;
                transition: width 0.5s ease;
            }
            
            .calibration-check {
                display: flex;
                align-items: center;
                margin: 8px 0;
                text-align: left;
            }
            
            .check-icon {
                width: 22px;
                height: 22px;
                margin-right: 8px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.8rem;
            }
            
            .check-icon.checked {
                background: #4ecdc4;
            }
            
            .motion-path {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 200px;
                height: 200px;
                border: 2px dashed rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                display: none;
                z-index: 5;
            }
            
            .shoulder-dot, .hip-dot {
                position: absolute;
                width: 10px;
                height: 10px;
                border-radius: 50%;
                transform: translate(-50%, -50%);
            }
            
            .shoulder-dot {
                background: #ff6b6b;
            }
            
            .hip-dot {
                background: #4ecdc4;
            }
            
            .school-logo {
                position: absolute;
                top: 15px;
                left: 15px;
                width: 60px;
                height: 60px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                font-size: 12px;
                text-align: center;
                color: white;
                z-index: 5;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
                border: 2px solid rgba(255, 255, 255, 0.2);
            }
            
            .recording-indicator {
                position: absolute;
                top: 15px;
                right: 15px;
                display: flex;
                align-items: center;
                background: rgba(220, 53, 69, 0.8);
                padding: 4px 8px;
                border-radius: 15px;
                font-size: 12px;
                color: white;
                z-index: 5;
                display: none;
            }
            
            .recording-dot {
                width: 8px;
                height: 8px;
                background: white;
                border-radius: 50%;
                margin-right: 5px;
                animation: recording-pulse 1.5s infinite;
            }
            
            .orientation-warning {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 200;
                padding: 20px;
                text-align: center;
                display: none;
            }
            
            .orientation-icon {
                font-size: 3rem;
                margin-bottom: 20px;
            }
            
            @keyframes pulse {
                0% { transform: translate(-50%, -50%) scale(1); }
                50% { transform: translate(-50%, -50%) scale(1.03); }
                100% { transform: translate(-50%, -50%) scale(1); }
            }
            
            @keyframes recording-pulse {
                0% { opacity: 1; }
                50% { opacity: 0.3; }
                100% { opacity: 1; }
            }
            
            /* 横屏警告 */
            @media (max-width: 768px) and (orientation: landscape) {
                .orientation-warning {
                    display: flex;
                }
            }
            
            /* 小屏幕手机调整 */
            @media (max-width: 380px) {
                h1 {
                    font-size: 1.5rem;
                }
                
                .game-area {
                    border-radius: 8px;
                }
                
                #game {
                    height: 40vh;
                    min-height: 250px;
                }
                
                .control-panel {
                    padding: 15px;
                }
                
                .stat-value {
                    font-size: 1.3rem;
                }
                
                button {
                    padding: 12px;
                    font-size: 0.9rem;
                }
            }
            `}
        </style>
    </head>
    <body>
        <div class="orientation-warning">
            <div class="orientation-icon">📱</div>
            <h2>请将手机旋转到竖屏模式</h2>
            <p>为了获得最佳游戏体验，请使用竖屏模式进行游戏</p>
        </div>
        
        <header>
            <h1>体感榨汁机游戏 - 手机版</h1>
            <p class="subtitle">通过腰部和胯部扭转控制榨汁机，制作美味果汁！</p>
        </header>
        
        <div class="container">
            <div class="game-area">
                <canvas id="game" width="600" height="400"></canvas>
                <div class="video-container">
                    <video id="webcam" playsinline></video>
                    <canvas class="pose-canvas" id="pose-canvas"></canvas>
                </div>
                <div class="prompt" id="prompt">转起来才有果汁喝哟！</div>
                
                <!-- 学校Logo -->
                <div class="school-logo" id="schoolLogo">
                    <div>学校</div>
                    <div>Logo</div>
                </div>
                
                <!-- 录制指示器 -->
                <div class="recording-indicator" id="recordingIndicator">
                    <div class="recording-dot"></div>
                    录制中
                </div>
                
                <!-- 运动轨迹可视化 -->
                <div class="motion-path" id="motionPath">
                    <div class="shoulder-dot" id="shoulderDot"></div>
                    <div class="hip-dot" id="hipDot"></div>
                </div>
                
                <!-- 校准覆盖层 -->
                <div class="calibration-overlay" id="calibrationOverlay">
                    <div class="calibration-content">
                        <h2 class="calibration-title">摄像头校准</h2>
                        <p>为了获得最佳游戏体验，请完成以下校准步骤：</p>
                        
                        <div class="calibration-steps">
                            <div class="calibration-check" id="step1">
                                <div class="check-icon" id="icon1">1</div>
                                <div>确保全身在摄像头视野内</div>
                            </div>
                            <div class="calibration-check" id="step2">
                                <div class="check-icon" id="icon2">2</div>
                                <div>保持站立姿势，面向摄像头</div>
                            </div>
                            <div class="calibration-check" id="step3">
                                <div class="check-icon" id="icon3">3</div>
                                <div>进行腰部和胯部扭转测试</div>
                            </div>
                        </div>
                        
                        <div class="calibration-progress">
                            <div class="calibration-progress-bar" id="calibrationProgress"></div>
                        </div>
                        
                        <div id="calibrationHint" style="font-size: 0.9rem; margin-bottom: 15px;">请站到摄像头前，确保全身可见...</div>
                        
                        <button id="btnCalibrate" style="margin-top: 10px;">开始校准</button>
                    </div>
                </div>
            </div>
            
            <div class="control-panel">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">剩余时间</div>
                        <div id="lblTime" class="stat-value">00:30</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">当前转速</div>
                        <div id="lblRPM" class="stat-value">0</div>
                    </div>
                </div>
                
                <div class="energy-bar-container">
                    <div class="energy-label">
                        <span>果汁能量</span>
                        <span id="energyPercent">0%</span>
                    </div>
                    <div class="energy-bar">
                        <div id="barEnergy"></div>
                    </div>
                </div>
                
                <div class="buttons">
                    <button id="btnCalibrateMain">开始校准</button>
                    <button id="btnStart" disabled>开始游戏</button>
                    <button id="btnStop" disabled>停止游戏</button>
                    <button id="btnDownload" disabled>下载视频</button>
                </div>
                
                <div class="hint-box">
                    <div id="hint">请先点击"开始校准"按钮完成摄像头校准</div>
                </div>
            </div>
        </div>
        
        <div class="instructions">
            <h2>游戏说明</h2>
            <ul>
                <li>面向摄像头站立，确保上半身可见</li>
                <li>通过腰部和胯部协调扭转控制榨汁机转速</li>
                <li>保持高转速以填充果汁能量</li>
                <li>游戏持续30秒，结束后会根据表现评分</li>
                <li>评分标准：转速、稳定性和能量填充度</li>
                <li><strong>技巧：</strong>想象肩膀和髋部在做圆形运动</li>
                <li><strong>分享：</strong>游戏结束后可以下载游戏视频分享</li>
            </ul>
        </div>

        <div style="text-align: center; margin-top: 20px;">
            <a href="/lobby" class="btn" style="background: #6c757d; padding: 10px 20px; text-decoration: none; color: white; border-radius: 8px;">← 返回游戏大厅</a>
            <a href="/" class="btn" style="background: #6c757d; padding: 10px 20px; text-decoration: none; color: white; border-radius: 8px;">🏠 返回首页</a>
        </div>

        <script>
            // 这里插入完整的手机版JavaScript代码
            // 由于代码较长，在实际部署时建议将JavaScript代码保存为单独文件
            // 这里为了完整性，包含了完整的游戏逻辑
            ${`
            /* ========= 手机版优化 ========= */
            
            // 禁用双击缩放
            document.addEventListener('touchstart', function(event) {
                if (event.touches.length > 1) {
                    event.preventDefault();
                }
            }, { passive: false });
            
            let lastTouchEnd = 0;
            document.addEventListener('touchend', function(event) {
                const now = (new Date()).getTime();
                if (now - lastTouchEnd <= 300) {
                    event.preventDefault();
                }
                lastTouchEnd = now;
            }, false);
            
            // 检测横屏并显示警告
            function checkOrientation() {
                if (window.innerHeight < window.innerWidth) {
                    document.querySelector('.orientation-warning').style.display = 'flex';
                } else {
                    document.querySelector('.orientation-warning').style.display = 'none';
                }
            }
            
            window.addEventListener('resize', checkOrientation);
            window.addEventListener('orientationchange', checkOrientation);
            checkOrientation(); // 初始检查

            /* ========= 游戏核心代码 ========= */
            
            // 为手机优化性能
            const W = 600, H = 400; // 降低分辨率以提高性能
            
            /* ========= Utilities ========= */
            const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
            const wrapPi = x => {
                while (x > Math.PI) x -= 2 * Math.PI;
                while (x < -Math.PI) x += 2 * Math.PI;
                return x;
            };
            const lerp = (a, b, t) => a + (b - a) * t;
            const fmtTime = ms => {
                const s = Math.max(0, Math.ceil(ms / 1000));
                return "00:" + String(s).padStart(2, "0");
            };

            /* ========= DOM refs ========= */
            const $ = sel => document.querySelector(sel);
            const btnStart = $("#btnStart");
            const btnStop = $("#btnStop");
            const btnDownload = $("#btnDownload");
            const lblTime = $("#lblTime");
            const lblRPM = $("#lblRPM");
            const barEnergy = $("#barEnergy");
            const energyPercent = $("#energyPercent");
            const hint = $("#hint");
            const prompt = $("#prompt");
            const webcam = $("#webcam");
            const canvas = $("#game");
            const ctx = canvas.getContext("2d");
            const poseCanvas = $("#pose-canvas");
            const poseCtx = poseCanvas.getContext("2d");
            const recordingIndicator = $("#recordingIndicator");
            const schoolLogo = $("#schoolLogo");
            
            // 校准相关元素
            const calibrationOverlay = $("#calibrationOverlay");
            const btnCalibrate = $("#btnCalibrate");
            const btnCalibrateMain = $("#btnCalibrateMain");
            const calibrationProgress = $("#calibrationProgress");
            const calibrationHint = $("#calibrationHint");
            const step1 = $("#step1");
            const step2 = $("#step2");
            const step3 = $("#step3");
            const icon1 = $("#icon1");
            const icon2 = $("#icon2");
            const icon3 = $("#icon3");
            
            // 运动轨迹可视化元素
            const motionPath = $("#motionPath");
            const shoulderDot = $("#shoulderDot");
            const hipDot = $("#hipDot");

            /* ========= Game State ========= */
            let pose = null, running = false, calibrated = false;
            let tStart = 0, tLast = 0, duration = 30_000; // 30s
            let energy = 0, rpmMin = 0, rpmMax = 2200, thetaCap = 45, thetaThresh = 12;
            let aPrev = 0, rpmHist = [];
            let audioCtx = null, motorOsc = null, motorGain = null;
            let lastPoseTime = 0;
            let lastTheta = 0;
            let angularVelocity = 0;
            let noMotionTimer = 0;
            let motionHistory = [];
            
            // 校准状态
            let calibrationState = 0;
            let calibrationTimer = 0;
            let calibrationData = {
                fullBodyDetected: false,
                standingPose: false,
                torsoRotation: false
            };
            
            // 运动轨迹跟踪
            let shoulderHistory = [];
            let hipHistory = [];
            let maxHistoryLength = 20; // 减少历史记录长度以节省内存
            
            // 视频录制
            let mediaRecorder = null;
            let recordedChunks = [];
            let isRecording = false;
            let combinedCanvas = null;
            let combinedCtx = null;

            /* ========= Audio ========= */
            function ensureAudio() {
                if (audioCtx) return;
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                motorGain = audioCtx.createGain();
                motorGain.gain.value = 0.0;
                motorOsc = audioCtx.createOscillator();
                motorOsc.type = "sawtooth";
                motorOsc.frequency.value = 100;
                motorOsc.connect(motorGain).connect(audioCtx.destination);
                motorOsc.start();
            }

            function updateMotorSound(rpm) {
                if (!motorOsc || !motorGain) return;
                
                if (rpm > 50) {
                    const f = 80 + (rpm / 2200) * 420;
                    const g = 0.05 + (rpm / 2200) * 0.22;
                    motorOsc.frequency.setTargetAtTime(f, audioCtx.currentTime, 0.03);
                    motorGain.gain.setTargetAtTime(g, audioCtx.currentTime, 0.05);
                } else {
                    motorGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.1);
                }
            }

            window.beep = (freq = 880, dur = 0.12, type = "sine", vol = 0.2) => {
                if (!audioCtx) ensureAudio();
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.type = type;
                o.frequency.value = freq;
                g.gain.value = vol;
                o.connect(g).connect(audioCtx.destination);
                o.start();
                o.stop(audioCtx.currentTime + dur);
            };

            async function countdownBeep() {
                ensureAudio();
                const seq = [660, 660, 660, 1000];
                for (let i = 0; i < seq.length; i++) {
                    beep(seq[i], i === 3 ? 0.2 : 0.12, i === 3 ? "square" : "sine", i === 3 ? 0.35 : 0.22);
                    await new Promise(r => setTimeout(r, 600));
                }
            }

            /* ========= MediaPipe Pose Detection ========= */
            async function createPoseDetector() {
                hint.innerHTML = "正在加载姿态检测模型...";
                
                pose = new Pose({
                    locateFile: (file) => {
                        return \`https://cdn.jsdelivr.net/npm/@mediapipe/pose/\${file}\`;
                    }
                });
                
                // 为手机优化设置
                pose.setOptions({
                    modelComplexity: 0, // 降低模型复杂度以提高性能
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    smoothSegmentation: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                
                pose.onResults(onPoseResults);
                
                // 设置摄像头
                const camera = new Camera(webcam, {
                    onFrame: async () => {
                        if (running || calibrationState > 0) {
                            await pose.send({image: webcam});
                        }
                    },
                    width: 320, // 降低分辨率以提高性能
                    height: 240
                });
                
                try {
                    await camera.start();
                    hint.innerHTML = "姿态检测模型加载完成！请点击开始校准按钮";
                    btnCalibrateMain.disabled = false;
                    return true;
                } catch (e) {
                    console.error("Camera error:", e);
                    hint.innerHTML = '<span class="bad">无法访问摄像头。请允许权限并刷新页面。</span>';
                    return false;
                }
            }

            function isFullBodyDetected(landmarks) {
                const keyPoints = [0, 11, 12, 23, 24];
                return keyPoints.every(index => landmarks[index] && landmarks[index].visibility > 0.5);
            }

            function isStandingPose(landmarks) {
                const LEFT_SHOULDER = 11;
                const RIGHT_SHOULDER = 12;
                const LEFT_HIP = 23;
                const RIGHT_HIP = 24;
                
                const Ls = landmarks[LEFT_SHOULDER];
                const Rs = landmarks[RIGHT_SHOULDER];
                const Lh = landmarks[LEFT_HIP];
                const Rh = landmarks[RIGHT_HIP];
                
                if (!(Ls && Rs && Lh && Rh)) return false;
                
                const shoulderAngle = Math.atan2(Rs.y - Ls.y, Rs.x - Ls.x);
                const hipAngle = Math.atan2(Rh.y - Lh.y, Rh.x - Lh.x);
                
                const angleDiff = Math.abs(wrapPi(shoulderAngle - hipAngle)) * 180 / Math.PI;
                
                return angleDiff < 15;
            }

            function isTorsoRotation(landmarks) {
                const LEFT_SHOULDER = 11;
                const RIGHT_SHOULDER = 12;
                const LEFT_HIP = 23;
                const RIGHT_HIP = 24;
                
                const Ls = landmarks[LEFT_SHOULDER];
                const Rs = landmarks[RIGHT_SHOULDER];
                const Lh = landmarks[LEFT_HIP];
                const Rh = landmarks[RIGHT_HIP];
                
                if (!(Ls && Rs && Lh && Rh)) return false;
                
                const shoulderAngle = Math.atan2(Rs.y - Ls.y, Rs.x - Ls.x);
                const hipAngle = Math.atan2(Rh.y - Lh.y, Rh.x - Lh.x);
                
                const angleDiff = Math.abs(wrapPi(shoulderAngle - hipAngle)) * 180 / Math.PI;
                
                const shoulderMidX = (Ls.x + Rs.x) / 2;
                const shoulderMidY = (Ls.y + Rs.y) / 2;
                const hipMidX = (Lh.x + Rh.x) / 2;
                const hipMidY = (Lh.y + Rh.y) / 2;
                
                const shoulderHipDiffX = Math.abs(shoulderMidX - hipMidX);
                
                const isRotation = angleDiff > thetaThresh && shoulderHipDiffX > 0.02;
                
                return isRotation;
            }

            function detectCircularMotion(landmarks) {
                const LEFT_SHOULDER = 11;
                const RIGHT_SHOULDER = 12;
                const LEFT_HIP = 23;
                const RIGHT_HIP = 24;
                
                const Ls = landmarks[LEFT_SHOULDER];
                const Rs = landmarks[RIGHT_SHOULDER];
                const Lh = landmarks[LEFT_HIP];
                const Rh = landmarks[RIGHT_HIP];
                
                if (!(Ls && Rs && Lh && Rh)) return { shoulderCircular: false, hipCircular: false, coordination: 0 };
                
                const shoulderMidX = (Ls.x + Rs.x) / 2;
                const shoulderMidY = (Ls.y + Rs.y) / 2;
                const hipMidX = (Lh.x + Rh.x) / 2;
                const hipMidY = (Lh.y + Rh.y) / 2;
                
                shoulderHistory.push({ x: shoulderMidX, y: shoulderMidY });
                hipHistory.push({ x: hipMidX, y: hipMidY });
                
                if (shoulderHistory.length > maxHistoryLength) {
                    shoulderHistory.shift();
                    hipHistory.shift();
                }
                
                let shoulderCircular = false;
                let hipCircular = false;
                let coordination = 0;
                
                if (shoulderHistory.length > 8) { // 减少所需帧数
                    const shoulderVariance = calculateCircularVariance(shoulderHistory);
                    shoulderCircular = shoulderVariance < 0.3;
                    
                    const hipVariance = calculateCircularVariance(hipHistory);
                    hipCircular = hipVariance < 0.3;
                    
                    coordination = calculateCoordination(shoulderHistory, hipHistory);
                }
                
                return { shoulderCircular, hipCircular, coordination };
            }

            function calculateCircularVariance(history) {
                if (history.length < 3) return 1;
                
                let centerX = 0, centerY = 0;
                for (const point of history) {
                    centerX += point.x;
                    centerY += point.y;
                }
                centerX /= history.length;
                centerY /= history.length;
                
                let totalRadius = 0;
                for (const point of history) {
                    const dx = point.x - centerX;
                    const dy = point.y - centerY;
                    totalRadius += Math.sqrt(dx * dx + dy * dy);
                }
                const avgRadius = totalRadius / history.length;
                
                let radiusVariance = 0;
                for (const point of history) {
                    const dx = point.x - centerX;
                    const dy = point.y - centerY;
                    const radius = Math.sqrt(dx * dx + dy * dy);
                    radiusVariance += Math.pow(radius - avgRadius, 2);
                }
                radiusVariance /= history.length;
                
                const normalizedVariance = radiusVariance / (avgRadius * avgRadius);
                
                return normalizedVariance;
            }

            function calculateCoordination(shoulderHistory, hipHistory) {
                if (shoulderHistory.length !== hipHistory.length || shoulderHistory.length < 3) return 0;
                
                let coordination = 0;
                for (let i = 1; i < shoulderHistory.length; i++) {
                    const shoulderDX = shoulderHistory[i].x - shoulderHistory[i-1].x;
                    const shoulderDY = shoulderHistory[i].y - shoulderHistory[i-1].y;
                    const hipDX = hipHistory[i].x - hipHistory[i-1].x;
                    const hipDY = hipHistory[i].y - hipHistory[i-1].y;
                    
                    const dotProduct = shoulderDX * hipDX + shoulderDY * hipDY;
                    const shoulderMagnitude = Math.sqrt(shoulderDX * shoulderDX + shoulderDY * shoulderDY);
                    const hipMagnitude = Math.sqrt(hipDX * hipDX + hipDY * hipDY);
                    
                    if (shoulderMagnitude > 0 && hipMagnitude > 0) {
                        const cosine = dotProduct / (shoulderMagnitude * hipMagnitude);
                        coordination += (1 - cosine) / 2;
                    }
                }
                
                return coordination / (shoulderHistory.length - 1);
            }

            function updateMotionVisualization(landmarks) {
                if (!landmarks) {
                    motionPath.style.display = 'none';
                    return;
                }
                
                const LEFT_SHOULDER = 11;
                const RIGHT_SHOULDER = 12;
                const LEFT_HIP = 23;
                const RIGHT_HIP = 24;
                
                const Ls = landmarks[LEFT_SHOULDER];
                const Rs = landmarks[RIGHT_SHOULDER];
                const Lh = landmarks[LEFT_HIP];
                const Rh = landmarks[RIGHT_HIP];
                
                if (!(Ls && Rs && Lh && Rh)) {
                    motionPath.style.display = 'none';
                    return;
                }
                
                const shoulderMidX = (Ls.x + Rs.x) / 2;
                const shoulderMidY = (Ls.y + Rs.y) / 2;
                const hipMidX = (Lh.x + Rh.x) / 2;
                const hipMidY = (Lh.y + Rh.y) / 2;
                
                const motionPathRect = motionPath.getBoundingClientRect();
                const gameRect = canvas.getBoundingClientRect();
                
                const shoulderX = (shoulderMidX * motionPathRect.width) + (gameRect.left - motionPathRect.left);
                const shoulderY = (shoulderMidY * motionPathRect.height) + (gameRect.top - motionPathRect.top);
                const hipX = (hipMidX * motionPathRect.width) + (gameRect.left - motionPathRect.left);
                const hipY = (hipMidY * motionPathRect.height) + (gameRect.top - motionPathRect.top);
                
                shoulderDot.style.left = \`\${shoulderX}px\`;
                shoulderDot.style.top = \`\${shoulderY}px\`;
                hipDot.style.left = \`\${hipX}px\`;
                hipDot.style.top = \`\${hipY}px\`;
                
                motionPath.style.display = 'block';
            }

            /* ========= 视频录制功能 ========= */
            function startRecording() {
                recordedChunks = [];
                
                try {
                    combinedCanvas = document.createElement('canvas');
                    combinedCanvas.width = canvas.width;
                    combinedCanvas.height = canvas.height;
                    combinedCtx = combinedCanvas.getContext('2d');
                    
                    const stream = combinedCanvas.captureStream(25); // 降低帧率以节省资源
                    
                    const options = { mimeType: 'video/mp4; codecs=avc1.42E01E' };
                    
                    mediaRecorder = new MediaRecorder(stream, options);
                    
                    mediaRecorder.ondataavailable = function(event) {
                        if (event.data.size > 0) {
                            recordedChunks.push(event.data);
                        }
                    };
                    
                    mediaRecorder.onstop = function() {
                        const blob = new Blob(recordedChunks, { type: 'video/mp4' });
                        const url = URL.createObjectURL(blob);
                        
                        btnDownload.disabled = false;
                        btnDownload.style.display = 'block';
                        btnDownload.onclick = function() {
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = \`榨汁机游戏_\${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.mp4\`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        };
                    };
                    
                    mediaRecorder.start();
                    isRecording = true;
                    recordingIndicator.style.display = 'flex';
                } catch (e) {
                    console.error('录制失败:', e);
                    // 如果MP4不支持，尝试WebM
                    try {
                        const stream = combinedCanvas.captureStream(25);
                        mediaRecorder = new MediaRecorder(stream, {
                            mimeType: 'video/webm; codecs=vp9'
                        });
                        
                        mediaRecorder.ondataavailable = function(event) {
                            if (event.data.size > 0) {
                                recordedChunks.push(event.data);
                            }
                        };
                        
                        mediaRecorder.onstop = function() {
                            const blob = new Blob(recordedChunks, { type: 'video/webm' });
                            const url = URL.createObjectURL(blob);
                            
                            btnDownload.disabled = false;
                            btnDownload.style.display = 'block';
                            btnDownload.onclick = function() {
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = \`榨汁机游戏_\${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm\`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            };
                        };
                        
                        mediaRecorder.start();
                        isRecording = true;
                        recordingIndicator.style.display = 'flex';
                    } catch (e2) {
                        console.error('WebM录制也失败:', e2);
                        alert('视频录制功能不可用，请使用现代浏览器如Chrome或Firefox');
                    }
                }
            }
            
            function stopRecording() {
                if (mediaRecorder && isRecording) {
                    mediaRecorder.stop();
                    isRecording = false;
                    recordingIndicator.style.display = 'none';
                }
            }
            
            function drawCombinedScene() {
                if (!combinedCtx) return;
                
                combinedCtx.clearRect(0, 0, combinedCanvas.width, combinedCanvas.height);
                
                combinedCtx.drawImage(canvas, 0, 0);
                
                const videoContainer = document.querySelector('.video-container');
                if (videoContainer && videoContainer.style.display !== 'none') {
                    combinedCtx.save();
                    combinedCtx.globalAlpha = 0.9;
                    combinedCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                    combinedCtx.fillRect(combinedCanvas.width - 110, 10, 100, 75);
                    combinedCtx.drawImage(poseCanvas, combinedCanvas.width - 110, 10, 100, 75);
                    combinedCtx.restore();
                }
                
                const logoRect = schoolLogo.getBoundingClientRect();
                const gameRect = canvas.getBoundingClientRect();
                if (logoRect && gameRect) {
                    combinedCtx.save();
                    combinedCtx.globalAlpha = 0.8;
                    combinedCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                    combinedCtx.beginPath();
                    combinedCtx.arc(logoRect.left - gameRect.left + 30, logoRect.top - gameRect.top + 30, 30, 0, Math.PI * 2);
                    combinedCtx.fill();
                    
                    combinedCtx.fillStyle = 'white';
                    combinedCtx.font = 'bold 12px Arial';
                    combinedCtx.textAlign = 'center';
                    combinedCtx.textBaseline = 'middle';
                    combinedCtx.fillText('学校', logoRect.left - gameRect.left + 30, logoRect.top - gameRect.top + 25);
                    combinedCtx.fillText('Logo', logoRect.left - gameRect.left + 30, logoRect.top - gameRect.top + 40);
                    combinedCtx.restore();
                }
                
                if (isRecording) {
                    combinedCtx.save();
                    combinedCtx.fillStyle = 'rgba(220, 53, 69, 0.8)';
                    combinedCtx.beginPath();
                    combinedCtx.arc(combinedCanvas.width - 20, 20, 6, 0, Math.PI * 2);
                    combinedCtx.fill();
                    combinedCtx.restore();
                }
            }

            function onPoseResults(results) {
                if (calibrationState > 0) {
                    handleCalibration(results);
                    return;
                }
                
                if (!running) return;
                
                poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
                poseCtx.save();
                poseCtx.scale(-1, 1);
                poseCtx.translate(-poseCanvas.width, 0);
                
                if (results.poseLandmarks) {
                    drawConnectors(poseCtx, results.poseLandmarks, POSE_CONNECTIONS, {
                        color: '#00FF00',
                        lineWidth: 1.5
                    });
                    drawLandmarks(poseCtx, results.poseLandmarks, {
                        color: '#FF0000',
                        lineWidth: 1,
                        radius: 1.5
                    });
                }
                
                poseCtx.restore();
                
                const now = performance.now();
                const dt = Math.min(100, now - lastPoseTime) / 1000;
                lastPoseTime = now;
                
                let rpm = rpmMin;
                let motionDetected = false;
                
                if (results.poseLandmarks) {
                    const currentTheta = computeTheta(results.poseLandmarks);
                    
                    if (lastTheta !== 0) {
                        const deltaTheta = Math.abs(currentTheta - lastTheta);
                        angularVelocity = deltaTheta / dt;
                        
                        const isRotation = isTorsoRotation(results.poseLandmarks);
                        
                        const circularMotion = detectCircularMotion(results.poseLandmarks);
                        
                        if (angularVelocity > 20 && isRotation && 
                            (circularMotion.shoulderCircular || circularMotion.hipCircular) &&
                            circularMotion.coordination > 0.3) {
                            
                            motionDetected = true;
                            
                            motionHistory.push(true);
                            if (motionHistory.length > 5) motionHistory.shift();
                            
                            const coordinationBonus = 1 + (circularMotion.coordination * 0.5);
                            rpm = clamp(angularVelocity * 10 * coordinationBonus, rpmMin, rpmMax);
                            
                            rpm = lerp(aPrev, rpm, 0.3);
                            aPrev = rpm;
                            
                            const energyMultiplier = 1 + (circularMotion.coordination * 0.3);
                            energy = clamp(energy + (rpm / rpmMax) * dt * 20 * energyMultiplier, 0, 100);
                        } else {
                            motionHistory.push(false);
                            if (motionHistory.length > 5) motionHistory.shift();
                            
                            rpm = lerp(aPrev, 0, 0.2);
                            aPrev = rpm;
                        }
                    } else {
                        motionHistory.push(false);
                        if (motionHistory.length > 5) motionHistory.shift();
                    }
                    
                    lastTheta = currentTheta;
                    
                    updateMotionVisualization(results.poseLandmarks);
                } else {
                    motionHistory.push(false);
                    if (motionHistory.length > 5) motionHistory.shift();
                    
                    rpm = lerp(aPrev, 0, 0.2);
                    aPrev = rpm;
                    
                    motionPath.style.display = 'none';
                }
                
                updateMotorSound(rpm);
                
                if (motionDetected) {
                    noMotionTimer = 0;
                    prompt.style.display = 'none';
                } else {
                    noMotionTimer += dt;
                    if (noMotionTimer > 3) {
                        prompt.style.display = 'block';
                    }
                }
                
                const progress = (now - tStart) / duration;
                drawScene(rpm, energy/100, progress, results.poseLandmarks);
                
                drawCombinedScene();

                rpmHist.push(rpm);
                lblRPM.textContent = rpm.toFixed(0);
                lblTime.textContent = fmtTime(duration - (now - tStart));
                barEnergy.style.width = energy.toFixed(1) + "%";
                energyPercent.textContent = energy.toFixed(1) + "%";

                if (now - tStart >= duration) {
                    stopGame(true);
                    return;
                }
            }

            /* ========= 校准逻辑 ========= */
            function startCalibration() {
                calibrationState = 1;
                calibrationOverlay.style.display = 'flex';
                btnCalibrate.disabled = true;
                calibrationTimer = 0;
                calibrationData = {
                    fullBodyDetected: false,
                    standingPose: false,
                    torsoRotation: false
                };
                
                icon1.className = 'check-icon';
                icon2.className = 'check-icon';
                icon3.className = 'check-icon';
                icon1.textContent = '1';
                icon2.textContent = '2';
                icon3.textContent = '3';
                
                calibrationProgress.style.width = '0%';
                calibrationHint.textContent = '请站到摄像头前，确保全身可见...';
            }

            function handleCalibration(results) {
                if (!results.poseLandmarks) {
                    calibrationHint.textContent = '未检测到人体，请确保全身在摄像头视野内...';
                    return;
                }
                
                const now = performance.now();
                const dt = Math.min(100, now - lastPoseTime) / 1000;
                lastPoseTime = now;
                calibrationTimer += dt;
                
                switch(calibrationState) {
                    case 1:
                        if (isFullBodyDetected(results.poseLandmarks)) {
                            calibrationData.fullBodyDetected = true;
                            icon1.className = 'check-icon checked';
                            icon1.textContent = '✓';
                            calibrationHint.textContent = '全身检测成功！请保持站立姿势...';
                            
                            if (calibrationTimer > 2) {
                                calibrationState = 2;
                                calibrationTimer = 0;
                                calibrationProgress.style.width = '33%';
                            }
                        } else {
                            calibrationHint.textContent = '请调整位置，确保全身在摄像头视野内...';
                        }
                        break;
                        
                    case 2:
                        if (isStandingPose(results.poseLandmarks)) {
                            calibrationData.standingPose = true;
                            icon2.className = 'check-icon checked';
                            icon2.textContent = '✓';
                            calibrationHint.textContent = '站立姿势检测成功！请进行腰部和胯部扭转测试...';
                            
                            if (calibrationTimer > 2) {
                                calibrationState = 3;
                                calibrationTimer = 0;
                                calibrationProgress.style.width = '66%';
                            }
                        } else {
                            calibrationHint.textContent = '请保持站立姿势，面向摄像头...';
                        }
                        break;
                        
                    case 3:
                        const circularMotion = detectCircularMotion(results.poseLandmarks);
                        
                        if (isTorsoRotation(results.poseLandmarks) && 
                            (circularMotion.shoulderCircular || circularMotion.hipCircular) &&
                            circularMotion.coordination > 0.3) {
                            
                            calibrationData.torsoRotation = true;
                            icon3.className = 'check-icon checked';
                            icon3.textContent = '✓';
                            calibrationHint.textContent = '腰部和胯部扭转测试成功！校准完成...';
                            
                            if (calibrationTimer > 2) {
                                calibrationState = 0;
                                calibrationProgress.style.width = '100%';
                                
                                setTimeout(() => {
                                    calibrationOverlay.style.display = 'none';
                                    calibrated = true;
                                    hint.innerHTML = '<span class="ok">校准完成！点击"开始游戏"按钮开始游戏。</span>';
                                    btnStart.disabled = false;
                                }, 1000);
                            }
                        } else {
                            calibrationHint.textContent = '请进行腰部和胯部协调扭转动作，想象肩膀和髋部在做圆形运动...';
                        }
                        break;
                }
            }

            /* ========= Geometry ========= */
            function computeTheta(landmarks) {
                const LEFT_SHOULDER = 11;
                const RIGHT_SHOULDER = 12;
                const LEFT_HIP = 23;
                const RIGHT_HIP = 24;
                
                const Ls = landmarks[LEFT_SHOULDER];
                const Rs = landmarks[RIGHT_SHOULDER];
                const Lh = landmarks[LEFT_HIP];
                const Rh = landmarks[RIGHT_HIP];
                
                if (!(Ls && Rs && Lh && Rh)) return 0;
                
                const as = Math.atan2(Rs.y - Ls.y, Rs.x - Ls.x);
                const ah = Math.atan2(Rh.y - Lh.y, Rh.x - Lh.x);
                
                let d = Math.abs(wrapPi(as - ah)) * 180 / Math.PI;
                return d;
            }

            /* ========= Render ========= */
            function drawScene(rpm, energy, progress, landmarks) {
                ctx.clearRect(0, 0, W, H);
                const g = ctx.createLinearGradient(0, 0, 0, H);
                g.addColorStop(0, "#0b1226"); g.addColorStop(1, "#0a1020");
                ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

                // 进度条
                ctx.fillStyle = "#1e293b"; ctx.fillRect(20, 18, W - 40, 10);
                ctx.fillStyle = "#60a5fa"; ctx.fillRect(20, 18, (1 - progress) * (W - 40), 10);

                // 果汁碗
                const bowl = { x: 70, y: 60, w: 220, h: 220, r: 12 };
                ctx.strokeStyle = "#7dd3fc"; ctx.lineWidth = 6;
                roundRect(ctx, bowl.x, bowl.y, bowl.w, bowl.h, bowl.r); ctx.stroke();

                // 绘制果汁液面
                const juiceLevel = bowl.y + bowl.h - energy * bowl.h;
                
                // 果汁液体
                ctx.save();
                ctx.beginPath(); 
                roundRect(ctx, bowl.x + 2, juiceLevel, bowl.w - 4, bowl.y + bowl.h - juiceLevel, 12);
                ctx.clip();
                
                // 果汁渐变
                const jg = ctx.createLinearGradient(0, juiceLevel, 0, bowl.y + bowl.h);
                jg.addColorStop(0, "#ffa726"); jg.addColorStop(1, "#fb8c00");
                ctx.fillStyle = jg; 
                ctx.fillRect(bowl.x, juiceLevel, bowl.w, bowl.y + bowl.h - juiceLevel);
                
                // 果汁表面光泽
                const highlight = ctx.createLinearGradient(bowl.x, juiceLevel, bowl.x + bowl.w, juiceLevel);
                highlight.addColorStop(0, "rgba(255,255,255,0.3)");
                highlight.addColorStop(0.5, "rgba(255,255,255,0.1)");
                highlight.addColorStop(1, "rgba(255,255,255,0.3)");
                ctx.fillStyle = highlight;
                ctx.fillRect(bowl.x, juiceLevel, bowl.w, 8);
                
                // 气泡
                for (let i = 0; i < 15; i++) {
                    const bx = bowl.x + 10 + (i * 15 % (bowl.w - 20));
                    const by = juiceLevel + 10 + (i * 25 % (bowl.y + bowl.h - juiceLevel - 10));
                    const r = 2 + (i % 3);
                    ctx.globalAlpha = 0.2 + (i % 3) * 0.1;
                    ctx.fillStyle = "#fff";
                    ctx.beginPath(); 
                    ctx.arc(bx, by, r, 0, Math.PI * 2); 
                    ctx.fill();
                }
                ctx.globalAlpha = 1.0;
                ctx.restore();

                // 榨汁机
                const cx = 465, cy = 180, r = 65;
                ctx.beginPath(); 
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.strokeStyle = "#93c5fd"; 
                ctx.lineWidth = 6; 
                ctx.stroke();

                // 榨汁机叶片
                const ang = (performance.now() / 1000) * (rpm / 60) * 2 * Math.PI;
                for (let i = 0; i < 3; i++) {
                    ctx.save(); 
                    ctx.translate(cx, cy); 
                    ctx.rotate(ang + i * 2 * Math.PI / 3);
                    ctx.fillStyle = "#e5e7eb"; 
                    ctx.fillRect(0, -10, r * 0.88, 20);
                    ctx.restore();
                }

                // 榨汁机中心
                ctx.beginPath();
                ctx.arc(cx, cy, 12, 0, Math.PI * 2);
                ctx.fillStyle = "#94a3b8";
                ctx.fill();

                // 转速显示
                ctx.fillStyle = "#e5e7eb"; 
                ctx.font = "700 18px ui-sans-serif";
                ctx.fillText(\`RPM: \${rpm.toFixed(0)}\`, cx - 45, cy + r + 25);
                
                // 在游戏画面右侧绘制骨架（如果检测到）
                if (landmarks) {
                    ctx.save();
                    ctx.translate(W - 150, 60);
                    ctx.scale(0.5, 0.5);
                    
                    // 绘制骨架连接线
                    drawConnectors(ctx, landmarks, POSE_CONNECTIONS, {
                        color: '#00FF00',
                        lineWidth: 2
                    });
                    
                    // 绘制关键点
                    drawLandmarks(ctx, landmarks, {
                        color: '#FF0000',
                        lineWidth: 1.5,
                        radius: 3
                    });
                    
                    ctx.restore();
                    
                    // 骨架标题
                    ctx.fillStyle = "#e5e7eb";
                    ctx.font = "14px ui-sans-serif";
                    ctx.fillText("姿态检测", W - 150, 50);
                }
            }

            function roundRect(ctx, x, y, w, h, r) {
                ctx.beginPath(); 
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + w, y, r);
                ctx.closePath();
            }

            /* ========= Start/Stop ========= */
            async function startGame() {
                if (!calibrated) {
                    hint.innerHTML = '<span class="bad">请先完成校准！</span>';
                    return;
                }
                
                btnStart.disabled = true; 
                btnStop.disabled = true;
                
                if (!pose) {
                    const success = await createPoseDetector();
                    if (!success) {
                        btnStart.disabled = false;
                        return;
                    }
                }

                hint.innerHTML = "准备开始！";

                await countdownBeep();

                running = true;
                tStart = performance.now();
                tLast = tStart;
                lastPoseTime = tStart;
                lastTheta = 0;
                rpmHist = [];
                energy = 0;
                aPrev = 0;
                angularVelocity = 0;
                noMotionTimer = 0;
                motionHistory = [];
                btnStop.disabled = false;
                prompt.style.display = 'none';
                hint.innerHTML = '<span class="ok">开始！持续扭转躯干 30 秒，越大越快越好！</span>';
                
                startRecording();
            }

            function stopGame(withSettle = false) {
                running = false;
                btnStart.disabled = false;
                btnStop.disabled = true;
                prompt.style.display = 'none';
                motionPath.style.display = 'none';
                
                stopRecording();
                
                if (motorGain) motorGain.gain.setTargetAtTime(0.0, audioCtx?.currentTime || 0, 0.1);
                if (withSettle) settle();
            }

            function settle() {
                const juiceScore = energy;
                
                const norm = rpmHist.map(v => (v - rpmMin) / (rpmMax - rpmMin));
                const mean = norm.length ? norm.reduce((a, b) => a + b, 0) / norm.length : 0;
                const sd = Math.sqrt(norm.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, norm.length));
                const stabilityScore = clamp(100 - 100 * sd * 1.8, 0, 100);
                
                const totalScore = 0.7 * juiceScore + 0.3 * stabilityScore;
                
                let tier;
                if (totalScore >= 90) tier = "丝滑满杯 🌟";
                else if (totalScore >= 75) tier = "浓郁可口 ✅";
                else if (totalScore >= 60) tier = "略有果粒 ⚠️";
                else tier = "继续努力 💪";
                
                alert(\`完成！\\n\\n果汁量: \${juiceScore.toFixed(1)}%\\n稳定性: \${stabilityScore.toFixed(1)}\\n\\n总分: \${totalScore.toFixed(1)} — \${tier}\\n\\n您可以点击"下载视频"按钮保存游戏视频分享到朋友圈！\`);
            }

            /* ========= UI ========= */
            btnStart.addEventListener("click", startGame);
            btnStop.addEventListener("click", () => stopGame(false));
            btnCalibrate.addEventListener("click", startCalibration);
            btnCalibrateMain.addEventListener("click", startCalibration);

            // 初始化
            window.addEventListener('load', async () => {
                // 设置姿态画布尺寸
                poseCanvas.width = 100;
                poseCanvas.height = 75;
                
                hint.innerHTML = "正在加载模型，请稍候...";
                
                try {
                    await createPoseDetector();
                    hint.innerHTML = "模型加载完成！请点击'开始校准'按钮进行校准";
                } catch (e) {
                    console.error("Failed to load pose detector:", e);
                    hint.innerHTML = '<span class="bad">模型加载失败，请刷新页面重试</span>';
                }
            });
            `}
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
  console.log(`📱 手机体感版: http://localhost:${PORT}/game/juice-maker-mobile`);
  console.log('=================================');
});

// 全局错误处理
process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 拒绝:', error);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});