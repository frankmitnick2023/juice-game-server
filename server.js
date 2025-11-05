// server.js  ——  完整可直接运行
// ---------------------------------------------------------------
// 1. 基础依赖（只保留一次）
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const WebSocket = require('ws');
const crypto    = require('crypto');

const app = express();

// ---------------------------------------------------------------
// 2. 必须的中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------
// 3. 你的原有路由 / API（全部保留在此区域）
// ---------------------------------------------------------------
// 请把原来的登录、注册、游戏逻辑粘贴到这里
// ---------------------------------------------------------------
// 示例：内存用户（实际请换成数据库 + bcrypt）
const users = new Map(); // username → { passwordHash }

// 注册（可选）
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '缺少参数' });
  if (users.has(username)) return res.status(400).json({ error: '用户已存在' });

  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  users.set(username, { passwordHash });
  res.json({ success: true, message: '注册成功' });
});

// 登录（必须返回 JSON）
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '缺少用户名或密码' });
  }
  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  if (inputHash !== user.passwordHash) {
    return res.status(401).json({ error: '密码错误' });
  }
  res.json({ success: true });
});

// ---------------------------------------------------------------
// 4. 投屏框架：静态资源
app.use('/games', express.static('games'));   // 所有游戏
app.use(express.static('public'));            // cast.html、inject.js

// ---------------------------------------------------------------
// 5. 通用大屏投屏页
app.get('/cast', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cast.html'));
});

// ---------------------------------------------------------------
// 6. 通用游戏播放页（自动注入投屏）
app.get('/play/:gameName', (req, res) => {
  const gamePath = path.join(__dirname, 'games', req.params.gameName, 'index.html');
  if (!fs.existsSync(gamePath)) {
    return res.status(404).send('Game not found');
  }

  const room = 'room-' + Date.now();

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body,html{margin:0;height:100vh;overflow:hidden;background:#000;}
    #gameFrame{width:100%;height:100%;border:none;}
    #castBtn{position:fixed;bottom:20px;right:20px;padding:12px 20px;
             background:#a855f7;color:#fff;border:none;border-radius:8px;
             font-weight:bold;z-index:9999;}
  </style>
</head>
<body>
  <iframe id="gameFrame" src="/games/${req.params.gameName}/index.html"
          sandbox="allow-scripts allow-same-origin"></iframe>
  <button id="castBtn">投屏到大屏</button>

  <script src="/inject.js"></script>
  <script>
    const room = '${room}';
    const gameFrame = document.getElementById('gameFrame');
    const castBtn   = document.getElementById('castBtn');
    let pc, ws;

    function injectScriptToIframe(iframe, src) {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const script = doc.createElement('script');
      script.src = src;
      script.onload = () => console.log('inject.js loaded');
      doc.head.appendChild(script);
    }

    function startCast(canvas) {
      ws = new WebSocket(\`wss://\${location.host}/ws-cast?room=\${room}\`);
      pc = new RTCPeerConnection();
      const stream = canvas.captureStream(30);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.onicecandidate = e => e.candidate && ws.send(JSON.stringify({ candidate: e.candidate }));

      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => ws.send(JSON.stringify({ sdp: pc.localDescription })));

      ws.onmessage = async msg => {
        const s = JSON.parse(msg.data);
        if (s.sdp?.type === 'answer') {
          await pc.setRemoteDescription(s);
          castBtn.textContent = '投屏中…';
          castBtn.disabled = true;
        }
      };
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'CAST_CANVAS_READY') {
        startCast(e.source.castCanvas);
      }
    });

    gameFrame.onload = () => injectScriptToIframe(gameFrame, '/inject.js');
  </script>
</body>
</html>
  `);
});

// ---------------------------------------------------------------
// 7. 兜底：所有未定义路由返回 JSON（防止 HTML 被 JSON.parse）
app.use((req, res, next) => {
  if (req.accepts('json') && !req.accepts('html')) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

// ---------------------------------------------------------------
// 8. 启动 HTTP + WebSocket
const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});

const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const { pathname, searchParams } = new URL(request.url, `http://${request.headers.host}`);
  if (pathname === '/ws-cast') {
    wss.handleUpgrade(request, socket, head, ws => {
      ws.roomId = searchParams.get('room') || 'default';
      ws.on('message', msg => {
        wss.clients.forEach(client => {
          if (client.roomId === ws.roomId && client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(msg);
          }
        });
      });
    });
  }
});