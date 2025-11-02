// server.js - 重构版智能游戏服务器
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

console.log('🚀 启动智能游戏服务器...');

// ==================== 初始化应用 ====================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ==================== 配置常量 ====================
const PORT = process.env.PORT || 8080;
const GAMES_DIR = path.join(__dirname, 'games');
const MANIFEST_FILE = path.join(GAMES_DIR, 'game-manifest.json');
const WIX_API_BASE = 'https://www.wixapis.com';

// ==================== 数据存储 ====================
const players = new Map();
let games = [];

// ==================== 核心功能模块 ====================

/**
 * 游戏管理模块
 */
const gameManager = {
    // 加载游戏清单
    loadGamesManifest() {
        try {
            if (fs.existsSync(MANIFEST_FILE)) {
                const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
                console.log(`🎮 加载了 ${manifest.games.length} 个游戏`);
                return manifest.games;
            }
        } catch (error) {
            console.error('❌ 读取游戏清单失败:', error);
        }
        
        return this.scanGamesDirectory();
    },

    // 自动扫描游戏文件夹
    scanGamesDirectory() {
        const games = [];
        
        try {
            if (!fs.existsSync(GAMES_DIR)) {
                fs.mkdirSync(GAMES_DIR, { recursive: true });
                console.log('📁 创建游戏文件夹');
                return games;
            }
            
            const files = fs.readdirSync(GAMES_DIR);
            const htmlFiles = files.filter(file => file.endsWith('.html'));
            
            console.log(`🔍 扫描到 ${htmlFiles.length} 个HTML游戏文件`);
            
            htmlFiles.forEach(file => {
                const gameId = path.basename(file, '.html');
                const game = {
                    id: gameId,
                    file: file,
                    title: this.formatGameTitle(gameId),
                    description: '一个有趣的游戏',
                    icon: '🎮',
                    version: 'v1.0',
                    category: '未分类',
                    tags: ['游戏'],
                    difficulty: '简单',
                    duration: '未知',
                    players: '1人'
                };
                games.push(game);
            });
            
        } catch (error) {
            console.error('❌ 扫描游戏文件夹失败:', error);
        }
        
        return games;
    },

    // 格式化游戏标题
    formatGameTitle(gameId) {
        return gameId
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    },

    // 重新加载游戏
    reloadGames() {
        games = this.loadGamesManifest();
        console.log('🔄 游戏清单已重新加载:', games.map(g => g.title));
        return games;
    },

    // 获取游戏信息
    getGameById(gameId) {
        return games.find(game => game.id === gameId);
    },

    // 获取游戏文件路径
    getGameFilePath(gameId) {
        const game = this.getGameById(gameId);
        return game ? path.join(GAMES_DIR, game.file) : null;
    }
};

/**
 * Wix API 模块
 */
const wixAPI = {
    // 调用 Wix API
    async call(endpoint, method = 'GET', body = null) {
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
    },

    // 通过邮箱查找用户
    async findUserByEmail(email) {
        try {
            const result = await this.call('/members/v1/members', 'GET');
            return result.members.find(member => 
                member.loginEmail.toLowerCase() === email.toLowerCase()
            );
        } catch (error) {
            console.error('查找用户失败:', error.message);
            throw error;
        }
    },

    // 测试 API 连接
    async testConnection() {
        try {
            const result = await this.call('/members/v1/members', 'GET');
            return {
                success: true,
                memberCount: result.members ? result.members.length : 0,
                sampleMembers: result.members ? result.members.slice(0, 3).map(m => ({
                    id: m.id,
                    email: m.loginEmail,
                    name: m.contact?.firstName || 'Unknown'
                })) : []
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
};

/**
 * 用户认证模块
 */
const authManager = {
    // 智能登录
    async smartLogin(email) {
        if (!email) {
            return { success: false, error: '请输入邮箱' };
        }
        
        try {
            console.log('尝试 Wix 登录:', email);
            
            // 1. 先尝试 Wix API
            const wixUser = await wixAPI.findUserByEmail(email);
            
            if (wixUser) {
                console.log('Wix 用户找到:', wixUser.loginEmail);
                return {
                    success: true,
                    user: {
                        id: wixUser.id,
                        email: wixUser.loginEmail,
                        name: wixUser.contact?.firstName || wixUser.loginEmail.split('@')[0],
                        source: 'wix'
                    }
                };
            } else {
                console.log('Wix 用户未找到，使用模拟用户');
                // 2. Wix 用户不存在，使用模拟用户
                return this.createDemoUser(email, 'demo');
            }
            
        } catch (error) {
            console.log('Wix API 错误，使用模拟用户:', error.message);
            // 3. Wix API 出错，使用模拟用户
            return this.createDemoUser(email, 'demo_fallback', error.message);
        }
    },

    // 创建演示用户
    createDemoUser(email, source = 'demo', error = null) {
        const userData = {
            success: true,
            user: {
                id: 'demo-' + Date.now(),
                email: email,
                name: email.split('@')[0],
                source: source
            },
            isDemo: true
        };
        
        if (error) {
            userData.error = error;
        }
        
        return userData;
    }
};

// ==================== 路由处理器 ====================

/**
 * API 路由
 */
const apiRoutes = {
    // 健康检查
    health(req, res) {
        res.json({ 
            status: 'ok', 
            message: '游戏服务器运行正常',
            gamesCount: games.length,
            timestamp: new Date().toISOString()
        });
    },

    // 获取游戏列表
    getGames(req, res) {
        res.json({
            success: true,
            games: games.map(game => ({
                id: game.id,
                title: game.title,
                description: game.description,
                icon: game.icon,
                version: game.version,
                category: game.category,
                tags: game.tags,
                difficulty: game.difficulty,
                duration: game.duration,
                players: game.players,
                image: game.image,
                color: game.color,
                comingSoon: game.comingSoon || false
            }))
        });
    },

    // 智能登录
    async smartLogin(req, res) {
        const { email } = req.body;
        const result = await authManager.smartLogin(email);
        res.json(result);
    },

    // 重新加载游戏
    reloadGames(req, res) {
        games = gameManager.reloadGames();
        res.json({
            success: true,
            message: `游戏清单已重新加载，当前有 ${games.length} 个游戏`,
            games: games.map(g => g.title)
        });
    },

    // 测试 Wix API
    async testWix(req, res) {
        try {
            console.log('🔍 详细测试 Wix API...');
            const result = await wixAPI.testConnection();
            
            res.json({
                ...result,
                apiKeyConfigured: !!process.env.WIX_API_KEY,
                message: result.success ? '✅ Wix API 详细测试完成' : '❌ Wix API 测试失败'
            });
            
        } catch (error) {
            res.json({
                success: false,
                error: error.message
            });
        }
    }
};

/**
 * 页面路由
 */
const pageRoutes = {
    // 首页
    home(req, res) {
        res.send(this.generateHomePage(games.length));
    },

    // 游戏大厅
    lobby(req, res) {
        const availableGames = games.filter(game => !game.comingSoon);
        const comingSoonGames = games.filter(game => game.comingSoon);
        res.send(this.generateLobbyPage(games.length, availableGames, comingSoonGames));
    },

    // 游戏页面
    game(req, res) {
        const { gameId } = req.params;
        const gameFile = gameManager.getGameFilePath(gameId);
        
        if (gameFile && fs.existsSync(gameFile)) {
            const htmlContent = fs.readFileSync(gameFile, 'utf8');
            const modifiedHtml = htmlContent.replace(
                '</body>',
                `
                <div style="text-align: center; margin: 20px; padding: 20px;">
                    <a href="/lobby" style="display: inline-block; padding: 10px 20px; background: #6c757d; color: white; text-decoration: none; border-radius: 8px; margin: 5px;">← 返回游戏大厅</a>
                    <a href="/" style="display: inline-block; padding: 10px 20px; background: #6c757d; color: white; text-decoration: none; border-radius: 8px; margin: 5px;">🏠 返回首页</a>
                </div>
                </body>`
            );
            res.send(modifiedHtml);
        } else {
            res.status(404).send(this.generateNotFoundPage(gameId));
        }
    },

    // 生成首页 HTML
    generateHomePage(gameCount) {
        return `
        <html>
            <head>
                <title>智能游戏中心</title>
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
                        max-width: 600px; 
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
                    .btn-secondary {
                        background: #4ecdc4;
                    }
                    .btn-secondary:hover {
                        background: #26a69a;
                    }
                    .stats {
                        background: rgba(255,255,255,0.1);
                        padding: 15px;
                        border-radius: 10px;
                        margin: 20px 0;
                    }
                    h1 {
                        font-size: 2.5em;
                        margin-bottom: 20px;
                        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎮 智能游戏中心</h1>
                    <p>自动检测到 <strong>${gameCount}</strong> 个游戏</p>
                    
                    <div class="stats">
                        <p>🎯 智能游戏管理系统</p>
                        <p>• 自动检测新游戏</p>
                        <p>• 无需修改服务器代码</p>
                        <p>• 动态游戏清单</p>
                    </div>
                    
                    <div style="margin: 30px 0;">
                        <a href="/lobby" class="btn">进入游戏大厅</a>
                        <a href="/health" class="btn btn-secondary">服务器状态</a>
                    </div>
                    
                    <div style="margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">
                        <h3>📁 添加新游戏</h3>
                        <p>只需将HTML游戏文件放入 <code>games</code> 文件夹</p>
                        <p>系统会自动检测并添加到游戏大厅！</p>
                    </div>
                </div>
            </body>
        </html>
        `;
    },

    // 生成游戏大厅 HTML
    generateLobbyPage(totalGames, availableGames, comingSoonGames) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>游戏大厅 - 智能游戏中心</title>
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
                    padding: 25px;
                    text-align: center;
                    backdrop-filter: blur(10px);
                    border: 2px solid rgba(255,255,255,0.2);
                    transition: all 0.3s ease;
                }
                .game-card.available {
                    cursor: pointer;
                }
                .game-card.available:hover {
                    transform: translateY(-10px);
                    background: rgba(255,255,255,0.15);
                    border-color: #ff6b6b;
                }
                .game-card.coming-soon {
                    opacity: 0.6;
                    filter: grayscale(0.3);
                }
                .game-icon { 
                    font-size: 3em; 
                    margin-bottom: 15px; 
                }
                .game-title { 
                    font-size: 1.4em; 
                    font-weight: bold; 
                    margin-bottom: 8px; 
                }
                .game-version {
                    background: rgba(255,255,255,0.2);
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 0.7em;
                    margin-left: 8px;
                }
                .game-description { 
                    opacity: 0.8; 
                    margin-bottom: 15px; 
                    line-height: 1.4;
                    font-size: 0.9em;
                }
                .game-meta {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8em;
                    opacity: 0.7;
                    margin-bottom: 15px;
                }
                .game-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                    justify-content: center;
                    margin-bottom: 15px;
                }
                .game-tag {
                    background: rgba(255,255,255,0.2);
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 0.7em;
                }
                .btn {
                    padding: 10px 20px;
                    background: #ff6b6b;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 1em;
                    cursor: pointer;
                    text-decoration: none;
                    display: inline-block;
                    transition: all 0.3s ease;
                }
                .btn:hover { 
                    background: #ff5252; 
                    transform: scale(1.05); 
                }
                .btn:disabled {
                    background: #6c757d;
                    cursor: not-allowed;
                    transform: none;
                }
                .btn-back { 
                    background: #6c757d; 
                }
                .btn-back:hover { 
                    background: #5a6268; 
                }
                .section-title {
                    margin: 40px 0 20px 0;
                    font-size: 1.5em;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎮 游戏大厅</h1>
                    <p>发现 ${totalGames} 个精彩游戏</p>
                </div>

                <div class="user-info">
                    <div id="userWelcome">欢迎来到游戏大厅！</div>
                    <div style="margin-top: 10px;">
                        <button onclick="simulateLogin()" class="btn">测试登录</button>
                        <button onclick="refreshGames()" class="btn btn-secondary">刷新游戏列表</button>
                    </div>
                </div>

                ${availableGames.length > 0 ? `
                <div class="section-title">🎯 可玩游戏</div>
                <div class="games-grid">
                    ${availableGames.map(game => `
                    <div class="game-card available" onclick="startGame('${game.id}')" style="border-color: ${game.color || '#ff6b6b'}">
                        <div class="game-icon">${game.icon}</div>
                        <div class="game-title">
                            ${game.title}
                            <span class="game-version">${game.version}</span>
                        </div>
                        <div class="game-description">${game.description}</div>
                        <div class="game-meta">
                            <span>${game.difficulty}</span>
                            <span>${game.duration}</span>
                            <span>${game.players}</span>
                        </div>
                        <div class="game-tags">
                            ${game.tags.map(tag => `<span class="game-tag">${tag}</span>`).join('')}
                        </div>
                        <button class="btn" style="background: ${game.color || '#ff6b6b'}">开始游戏</button>
                    </div>
                    `).join('')}
                </div>
                ` : ''}

                ${comingSoonGames.length > 0 ? `
                <div class="section-title">🚧 即将推出</div>
                <div class="games-grid">
                    ${comingSoonGames.map(game => `
                    <div class="game-card coming-soon">
                        <div class="game-icon">${game.icon}</div>
                        <div class="game-title">
                            ${game.title}
                            <span class="game-version">${game.version}</span>
                        </div>
                        <div class="game-description">${game.description}</div>
                        <div class="game-meta">
                            <span>${game.difficulty}</span>
                            <span>${game.duration}</span>
                            <span>${game.players}</span>
                        </div>
                        <button class="btn" disabled>即将推出</button>
                    </div>
                    `).join('')}
                </div>
                ` : ''}

                <div style="text-align: center; margin-top: 40px;">
                    <a href="/" class="btn btn-back">🏠 返回首页</a>
                </div>
            </div>

            <script>
                function simulateLogin() {
                    const testUser = {
                        name: '测试玩家',
                        email: 'test@example.com'
                    };
                    localStorage.setItem('game_user', JSON.stringify(testUser));
                    localStorage.setItem('game_logged_in', 'true');
                    document.getElementById('userWelcome').textContent = 
                        '欢迎 ' + testUser.name + ' 来到游戏大厅！';
                }

                function startGame(gameId) {
                    window.location.href = '/game/' + gameId;
                }

                function refreshGames() {
                    fetch('/api/games')
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                alert('游戏列表已刷新！');
                                location.reload();
                            }
                        });
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
        `;
    },

    // 生成404页面
    generateNotFoundPage(gameId) {
        return `
        <html>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h2>❌ 游戏未找到</h2>
                <p>游戏 ${gameId} 不存在</p>
                <a href="/lobby">返回游戏大厅</a>
            </body>
        </html>
        `;
    }
};

// ==================== Socket.IO 逻辑 ====================
io.on('connection', (socket) => {
    console.log('🔗 玩家连接:', socket.id);

    socket.on('join_game', (playerData) => {
        const { username, email } = playerData;
        console.log(`👤 玩家加入: ${username}`);
        
        players.set(socket.id, {
            id: socket.id,
            username: username,
            email: email,
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

// ==================== 路由注册 ====================

// API 路由
app.get('/health', apiRoutes.health);
app.get('/api/games', apiRoutes.getGames);
app.post('/api/smart-login', apiRoutes.smartLogin);
app.post('/admin/reload-games', apiRoutes.reloadGames);
app.get('/api/test-wix', apiRoutes.testWix);

// 页面路由
app.get('/', pageRoutes.home);
app.get('/lobby', pageRoutes.lobby);
app.get('/game/:gameId', pageRoutes.game);

// ==================== 初始化服务器 ====================

// 初始化游戏
games = gameManager.loadGamesManifest();

// 启动服务器
server.listen(PORT, () => {
    console.log('=================================');
    console.log('🎮 智能游戏服务器已启动!');
    console.log(`📍 端口: ${PORT}`);
    console.log(`🎯 游戏数量: ${games.length}`);
    console.log(`🌐 首页: http://localhost:${PORT}/`);
    console.log(`🏠 游戏大厅: http://localhost:${PORT}/lobby`);
    console.log('=================================');
    
    // 显示可用游戏
    games.forEach((game, index) => {
        console.log(`   ${index + 1}. ${game.title} - /game/${game.id}`);
    });
});

// ==================== 全局错误处理 ====================
process.on('unhandledRejection', (error) => {
    console.error('未处理的 Promise 拒绝:', error);
});

process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
});