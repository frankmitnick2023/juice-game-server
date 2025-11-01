// server.js - 体感榨汁机游戏服务器（稳定修复版）
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors'); // 修复：使用正确的 cors 包

console.log('🚀 启动体感榨汁机游戏服务器...');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==================== WIX API 配置 ====================
const WIX_API_BASE = 'https://www.wixapis.com';

// Wix API 工具函数（添加错误处理）
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

// 通过邮箱查找 Wix 用户（简化版，先确保基础功能）
async function findWixUserByEmail(email) {
  try {
    console.log('🔍 查找 Wix 用户:', email);
    
    // 简化：只尝试 Members API
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

// 获取所有 Wix 联系人（简化版）
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
          body { font-family: Arial; text-align: center; padding: 50px; }
          .container { max-width: 500px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎮 学校游戏中心</h1>
          <p>服务器运行正常</p>
          <p><a href="/health">健康检查</a></p>
        </div>
      </body>
    </html>
  `);
});

// Wix OAuth 回调路由
app.get('/auth-callback', (req, res) => {
  const { code } = req.query;
  
  if (code) {
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'wix-oauth-callback',
                code: '${code}'
              }, '*');
            }
            setTimeout(() => window.close(), 2000);
          </script>
          <h2>✅ 认证成功！</h2>
        </body>
      </html>
    `);
  } else {
    res.status(400).send('缺少认证代码');
  }
});

// ==================== 基础 API 路由 ====================

// 测试 API Key 配置
app.get('/api/test-wix', (req, res) => {
  const API_KEY = process.env.WIX_API_KEY;
  res.json({
    apiKeyConfigured: !!API_KEY,
    message: API_KEY ? '✅ Wix API Key 已配置' : '❌ Wix API Key 未配置'
  });
});

// 简化版 Wix 用户登录
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

// 简化版获取联系人
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

// 基础 Socket.IO 连接处理
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

  // 心跳
  socket.on('ping', () => {
    socket.emit('pong', { time: new Date().toISOString() });
  });
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

// 测试具体的 Members API 端点
app.get('/api/test-members-specific', async (req, res) => {
  try {
    const tests = {};
    
    // 测试 1: 获取当前用户信息（如果有用户上下文）
    try {
      const currentResult = await callWixAPI('/members/v1/members/current', 'GET');
      tests.currentMember = { 
        success: true, 
        exists: !!currentResult.member,
        data: currentResult 
      };
    } catch (error) {
      tests.currentMember = { success: false, error: error.message };
    }
    
    // 测试 2: 通过 ID 获取特定成员（需要知道成员ID）
    try {
      // 这里需要提供一个已知的成员ID，我们先用一个测试ID
      const byIdResult = await callWixAPI('/members/v1/members/some-member-id', 'GET');
      tests.memberById = { success: true, data: byIdResult };
    } catch (error) {
      tests.memberById = { success: false, error: error.message };
    }
    
    // 测试 3: 查询成员（带过滤条件）
    try {
      const queryResult = await callWixAPI('/members/v1/members/query', 'POST', {
        query: {
          filter: {
            'status': 'ACTIVE'
          },
          paging: {
            limit: 5
          }
        }
      });
      tests.membersQuery = { 
        success: true, 
        count: queryResult.members?.length || 0 
      };
    } catch (error) {
      tests.membersQuery = { success: false, error: error.message };
    }
    
    // 测试 4: 站点成员统计
    try {
      const statsResult = await callWixAPI('/members/v1/members/stats', 'GET');
      tests.memberStats = { success: true, data: statsResult };
    } catch (error) {
      tests.memberStats = { success: false, error: error.message };
    }
    
    res.json({
      success: true,
      tests: tests,
      message: '具体 Members API 端点测试完成'
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 测试 Data API 中的 Members 数据集合
app.get('/api/test-data-members', async (req, res) => {
  try {
    console.log('🔍 测试 Data API 中的 Members 数据');
    
    // 尝试不同的数据集合名称
    const collections = ['Members', 'SiteMembers', 'Memberships', 'Users'];
    const results = {};
    
    for (const collection of collections) {
      try {
        const result = await callWixAPI('/wix-data/v2/items/query', 'POST', {
          dataCollectionId: collection,
          query: {
            paging: { limit: 3 }
          }
        });
        
        results[collection] = {
          exists: true,
          count: result.items ? result.items.length : 0,
          sample: result.items ? result.items.slice(0, 2) : []
        };
      } catch (error) {
        results[collection] = {
          exists: false,
          error: error.message
        };
      }
    }
    
    res.json({
      success: true,
      dataCollections: results,
      message: 'Data API Members 测试完成'
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// ==================== WIX OAuth PKCE 流程 ====================

// 生成随机字符串
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 启动 PKCE OAuth 流程
app.get('/api/wix-oauth-pkce', (req, res) => {
  const codeVerifier = generateRandomString(128);
  const state = generateRandomString(16);
  
  // 保存用于验证（在实际应用中应该用session）
  res.cookie('oauth_code_verifier', codeVerifier, { httpOnly: true });
  res.cookie('oauth_state', state, { httpOnly: true });
  
  const authUrl = `https://www.wix.com/installer/oauth2/authorize?client_id=54186d51-7e8a-483d-b2bd-854aa1ba75ad&redirect_uri=${encodeURIComponent('https://juice-game-server2-production.up.railway.app/auth-callback')}&response_type=code&scope=members:read&state=${state}`;
  
  res.json({
    success: true,
    authUrl: authUrl,
    codeVerifier: codeVerifier,
    state: state,
    message: 'PKCE OAuth 流程已启动'
  });
});

// 处理 OAuth 回调（简化版）
app.get('/auth-callback-final', (req, res) => {
  const { code, error, state } = req.query;
  
  console.log('🎯 OAuth 回调最终版:', { code: code ? '有代码' : '无代码', error, state });
  
  if (error) {
    return res.send(`
      <html>
        <head><title>登录失败</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: red;">❌ Wix 登录失败</h2>
          <p>错误: ${error}</p>
          <button onclick="window.close()" style="padding: 10px 20px; background: #ff6b6b; color: white; border: none; border-radius: 5px; cursor: pointer;">关闭窗口</button>
        </body>
      </html>
    `);
  }
  
  if (code) {
    res.send(`
      <html>
        <head><title>登录成功</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: green;">✅ 授权成功！</h2>
          <p>正在处理您的登录信息...</p>
          <script>
            // 将授权代码发送回主窗口
            setTimeout(() => {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage({
                  type: 'wix-oauth-success',
                  code: '${code}',
                  state: '${state || ''}'
                }, '*');
                
                // 给主窗口一些时间处理，然后关闭
                setTimeout(() => {
                  window.close();
                }, 1000);
              } else {
                document.body.innerHTML = '<h2>⚠️ 请返回原窗口</h2><p>主窗口已关闭，请返回游戏页面重试。</p><button onclick="window.close()">关闭</button>';
              }
            }, 500);
          </script>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: red;">❌ 缺少授权代码</h2>
          <button onclick="window.close()">关闭</button>
        </body>
      </html>
    `);
  }
});

// 使用授权代码获取用户信息
app.post('/api/wix-user-info', async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.json({ success: false, error: '缺少授权代码' });
  }
  
  try {
    console.log('🔍 使用 OAuth code 获取用户信息:', code.substring(0, 20) + '...');
    
    // 方法1: 直接使用 code 作为 Bearer token（某些配置支持）
    let userResponse = await fetch('https://www.wixapis.com/members/v1/members/current', {
      headers: {
        'Authorization': `Bearer ${code}`,
        'Content-Type': 'application/json'
      }
    });
    
    // 如果方法1失败，尝试方法2: 使用 code 作为 Basic auth
    if (!userResponse.ok) {
      userResponse = await fetch('https://www.wixapis.com/members/v1/members/current', {
        headers: {
          'Authorization': `Basic ${Buffer.from(code + ':').toString('base64')}`,
          'Content-Type': 'application/json'
        }
      });
    }
    
    // 如果方法2失败，尝试方法3: 直接传递 code
    if (!userResponse.ok) {
      userResponse = await fetch('https://www.wixapis.com/members/v1/members/current', {
        headers: {
          'Authorization': code,
          'Content-Type': 'application/json'
        }
      });
    }
    
    if (userResponse.ok) {
      const userData = await userResponse.json();
      
      if (userData.member) {
        console.log('✅ 获取到 Wix 用户信息:', userData.member.loginEmail);
        
        return res.json({
          success: true,
          user: {
            id: userData.member.id,
            email: userData.member.loginEmail,
            name: userData.member.contact?.firstName || userData.member.loginEmail.split('@')[0],
            fullName: (userData.member.contact?.firstName || '') + ' ' + (userData.member.contact?.lastName || ''),
            profilePhoto: userData.member.profile?.photo,
            slug: userData.member.slug,
            status: userData.member.status,
            wixData: userData.member
          },
          message: 'Wix 用户登录成功！'
        });
      }
    }
    
    // 如果所有方法都失败
    const errorText = await userResponse.text();
    console.error('❌ 获取用户信息失败:', userResponse.status, errorText);
    
    res.json({
      success: false,
      error: `无法获取用户信息 (${userResponse.status})`,
      details: errorText,
      requiresFullOAuth: true
    });
    
  } catch (error) {
    console.error('获取用户信息异常:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});
// 增强的 OAuth 回调处理
app.get('/auth-callback', (req, res) => {
  const { code, error, error_description, state, scope } = req.query;
  
  console.log('🔐 OAuth 回调详细参数:', {
    code: code ? '有代码' : '无代码',
    error: error || '无错误',
    error_description: error_description || '无错误描述',
    state: state || '无state',
    scope: scope || '无scope',
    fullQuery: req.query
  });
  
  if (error) {
    return res.send(`
      <html>
        <head><title>登录失败</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: red;">❌ Wix 登录失败</h2>
          <p><strong>错误:</strong> ${error}</p>
          <p><strong>描述:</strong> ${error_description || '无详细描述'}</p>
          <p><strong>State:</strong> ${state || '无'}</p>
          <button onclick="window.close()" style="padding: 10px 20px; background: #ff6b6b; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 10px;">
            关闭窗口
          </button>
        </body>
      </html>
    `);
  }
  
  if (code) {
    res.send(`
      <html>
        <head><title>登录成功</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: green;">✅ 授权成功！</h2>
          <p><strong>代码长度:</strong> ${code.length} 字符</p>
          <p><strong>State:</strong> ${state || '无'}</p>
          <p>正在处理您的登录信息...</p>
          <script>
            console.log('🎯 OAuth 回调收到代码:', '${code.substring(0, 20)}...');
            setTimeout(() => {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage({
                  type: 'wix-oauth-success',
                  code: '${code}',
                  state: '${state || ''}'
                }, '*');
                console.log('✅ 代码已发送到主窗口');
                
                setTimeout(() => {
                  window.close();
                }, 1000);
              } else {
                document.body.innerHTML = '<h2>⚠️ 请返回原窗口</h2><p>主窗口已关闭，请返回游戏页面重试。</p><button onclick="window.close()">关闭</button>';
              }
            }, 500);
          </script>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <html>
        <head><title>登录问题</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: orange;">⚠️ 登录未完成</h2>
          <p><strong>可能的原因:</strong></p>
          <ul style="text-align: left; display: inline-block; margin: 20px;">
            <li>用户取消了登录</li>
            <li>权限被拒绝</li>
            <li>Wix App 配置问题</li>
          </ul>
          <p><strong>收到的参数:</strong></p>
          <p>Code: ${code ? '有' : '无'}</p>
          <p>Error: ${error || '无'}</p>
          <p>State: ${state || '无'}</p>
          <button onclick="window.close()" style="padding: 10px 20px; background: #ff6b6b; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 10px;">
            关闭窗口
          </button>
          <button onclick="window.history.back()" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 10px;">
            返回重试
          </button>
        </body>
      </html>
    `);
  }
});