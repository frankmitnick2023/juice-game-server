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