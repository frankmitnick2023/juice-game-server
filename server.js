// server.js - 体感榨汁机游戏服务器（简化稳定版）
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

console.log('🚀 启动体感榨汁机游戏服务器...');

const app = express();
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '榨汁机服务器运行正常',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>榨汁机游戏服务器</title></head>
      <body>
        <h1>🎮 体感榨汁机游戏服务器</h1>
        <p>状态: <strong>运行中</strong></p>
        <p>时间: ${new Date().toISOString()}</p>
        <p><a href="/health">健康检查</a></p>
      </body>
    </html>
  `);
});

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