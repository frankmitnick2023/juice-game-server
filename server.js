// server.js - 体感榨汁机游戏服务器（简化稳定版）
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');


console.log('🚀 启动体感榨汁机游戏服务器...');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const WIX_API_BASE = 'https://www.wixapis.com';

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '榨汁机服务器运行正常',
    timestamp: new Date().toISOString()
  });
});


// ==================== API 路由 ====================

// Wix 用户登录验证
app.post('/api/wix-login', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.json({ success: false, error: '请输入邮箱' });
  }
  
  try {
    console.log('🔍 查找 Wix 用户:', email);
    
    // 在 Wix 中查找用户
    const wixUser = await findWixUserByEmail(email);
    
    if (wixUser) {
      console.log('✅ 找到 Wix 用户:', wixUser);
      
      // 返回成功响应
      res.json({
        success: true,
        user: {
          id: wixUser.id || wixUser._id,
          email: wixUser.email,
          name: wixUser.displayName || wixUser.name || wixUser.email.split('@')[0],
          avatar: wixUser.photo || wixUser.picture || null,
          wixData: wixUser // 包含完整的 Wix 用户数据
        },
        message: '登录成功'
      });
    } else {
      console.log('❌ 未找到 Wix 用户:', email);
      res.json({ 
        success: false, 
        error: '该邮箱未在学校系统注册，请先联系管理员' 
      });
    }
  } catch (error) {
    console.error('登录错误:', error);
    res.json({ 
      success: false, 
      error: '系统错误，请稍后重试: ' + error.message 
    });
  }
});

// 测试路由：获取所有用户
app.get('/api/wix-users', async (req, res) => {
  try {
    console.log('🧪 测试获取 Wix 用户列表');
    const result = await getAllWixUsers();
    
    res.json({ 
      success: true, 
      dataCollection: result.collection,
      count: result.users.length,
      users: result.users.map(u => ({ 
        id: u.id || u._id, 
        email: u.email, 
        name: u.displayName || u.name || '未知',
        rawData: u // 包含完整数据用于调试
      }))
    });
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.json({ 
      success: false, 
      error: error.message,
      dataCollection: 'none'
    });
  }
});

// 测试 API Key 配置
app.get('/api/test-wix', async (req, res) => {
  try {
    const API_KEY = process.env.WIX_API_KEY;
    res.json({
      apiKeyConfigured: !!API_KEY,
      apiKeyLength: API_KEY ? API_KEY.length : 0,
      message: API_KEY ? '✅ Wix API Key 已配置' : '❌ Wix API Key 未配置'
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get('/auth-callback', (req, res) => {
  const { code, error, state } = req.query;
  
  console.log('Wix OAuth 回调收到:', { code, error, state });
  
  if (error) {
    return res.send(`
      <html>
        <body>
          <h2>登录失败</h2>
          <p>错误: ${error}</p>
          <button onclick="window.close()">关闭</button>
        </body>
      </html>
    `);
  }
  
  if (code) {
    res.send(`
      <html>
        <head>
          <title>认证成功</title>
        </head>
        <body>
          <script>
            // 将认证代码传递回主窗口
            if (window.opener) {
              window.opener.postMessage({
                type: 'wix-oauth-callback',
                code: '${code}',
                state: '${state || ''}'
              }, '*');
            }
            
            // 3秒后自动关闭窗口
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
          <div style="text-align: center; padding: 50px;">
            <h2>✅ 认证成功！</h2>
            <p>正在跳转，请稍候...</p>
            <p>如果窗口没有自动关闭，<a href="#" onclick="window.close()">点击这里</a></p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.status(400).send('缺少认证代码');
  }
});

// Wix API 工具函数
async function callWixAPI(endpoint, method = 'GET', body = null) {
  const API_KEY = process.env.WIX_API_KEY;
  
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
    const response = await fetch(`${WIX_API_BASE}${endpoint}`, options);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Wix API 调用失败:', error);
    throw error;
  }
}

// 通过邮箱查找联系人
async function findWixContactByEmail(email) {
  try {
    console.log('🔍 通过 Contacts API 查找用户:', email);
    
    const result = await callWixAPI('/contacts/v4/contacts/query', 'POST', {
      query: {
        filter: {
          'info.email': email
        }
      },
      paging: {
        limit: 1
      }
    });
    
    if (result.contacts && result.contacts.length > 0) {
      console.log('✅ 通过 Contacts API 找到用户');
      return result.contacts[0];
    }
    
    // 如果 Contacts API 没找到，尝试 Members API
    console.log('🔍 尝试通过 Members API 查找用户');
    const memberResult = await callWixAPI('/members/v1/members', 'GET');
    
    if (memberResult.members) {
      const member = memberResult.members.find(m => m.loginEmail === email || m.contactId === email);
      if (member) {
        console.log('✅ 通过 Members API 找到用户');
        return member;
      }
    }
    
    return null;
  } catch (error) {
    console.error('查找用户失败:', error);
    return null;
  }
}

// 获取所有联系人（用于测试）
async function getAllWixContacts() {
  try {
    console.log('📞 获取所有联系人');
    
    // 先尝试 Contacts API
    const contactsResult = await callWixAPI('/contacts/v4/contacts', 'GET');
    
    if (contactsResult.contacts) {
      return {
        api: 'contacts',
        count: contactsResult.contacts.length,
        items: contactsResult.contacts
      };
    }
    
    // 如果 Contacts API 失败，尝试 Members API
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
    console.error('获取联系人失败:', error);
    return { api: 'error', count: 0, items: [], error: error.message };
  }
}

// 存储游戏数据
const gameRooms = new Map();
const players = new Map();

// 处理连接
io.on('connection', (socket) => {
  console.log('🔗 玩家连接:', socket.id);

  // 玩家加入
  socket.on('join_game', (playerData) => {
    const { username, email } = playerData;
    console.log(`👤 玩家加入: ${username} (${email})`);
    
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

  // 创建房间
  socket.on('create_room', (roomData) => {
    const player = players.get(socket.id);
    if (!player) return;

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const room = {
      id: roomId,
      players: [player],
      status: 'waiting',
      createdAt: new Date()
    };

    gameRooms.set(roomId, room);
    player.room = roomId;
    socket.join(roomId);

    socket.emit('room_created', {
      roomId: roomId,
      message: '房间创建成功，等待其他玩家...'
    });

    console.log(`🎮 房间创建: ${roomId} by ${player.username}`);
  });

  // 加入房间
  socket.on('join_room', (data) => {
    const player = players.get(socket.id);
    const room = gameRooms.get(data.roomId);

    if (!player || !room) {
      socket.emit('join_error', { message: '房间不存在' });
      return;
    }

    if (room.players.length >= 4) {
      socket.emit('join_error', { message: '房间已满' });
      return;
    }

    room.players.push(player);
    player.room = data.roomId;
    socket.join(data.roomId);

    // 通知所有玩家
    io.to(data.roomId).emit('player_joined', {
      newPlayer: player.username,
      roomSize: room.players.length,
      message: `玩家 ${player.username} 加入了房间`
    });

    console.log(`✅ 玩家 ${player.username} 加入房间 ${data.roomId}`);
  });

  // 游戏状态更新
  socket.on('game_update', (data) => {
    const player = players.get(socket.id);
    if (!player || !player.room) return;

    // 更新玩家分数
    player.score = data.score || 0;
    player.energy = data.energy || 0;

    // 广播给同房间的其他玩家
    socket.to(player.room).emit('opponent_update', {
      playerId: socket.id,
      username: player.username,
      score: player.score,
      energy: player.energy
    });
  });

  // 开始游戏
  socket.on('start_game', () => {
    const player = players.get(socket.id);
    if (!player || !player.room) return;

    const room = gameRooms.get(player.room);
    if (room) {
      room.status = 'playing';
      io.to(room.id).emit('game_started', {
        message: '游戏开始！',
        duration: 30000 // 30秒
      });
      console.log(`🎯 游戏开始: ${room.id}`);
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`❌ 玩家断开: ${player.username}`);
      
      // 从房间移除
      if (player.room) {
        const room = gameRooms.get(player.room);
        if (room) {
          room.players = room.players.filter(p => p.id !== socket.id);
          socket.to(player.room).emit('player_left', {
            username: player.username,
            message: '玩家离开了游戏'
          });
        }
      }
      
      players.delete(socket.id);
    }
  });

  // 心跳
  socket.on('ping', () => {
    socket.emit('pong', { time: new Date().toISOString() });
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=================================');
  console.log('🎮 体感榨汁机游戏服务器已启动!');
  console.log(`📍 端口: ${PORT}`);
  console.log(`🌐 本地访问: http://localhost:${PORT}`);
  console.log(`❤️  健康检查: http://localhost:${PORT}/health`);
  console.log('=================================');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 关闭服务器...');
  process.exit(0);
});