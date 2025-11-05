// server.js —— 完整可运行（含注册 + 登录 + 投屏）
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const WebSocket = require('ws');
const crypto    = require('crypto');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------
// 1. 内存用户系统（实际请换成数据库）
const users = new Map(); // username → { passwordHash }

// 默认测试用户
users.set('admin', { passwordHash: crypto.createHash('sha256').update('123456').digest('hex') });

// ---------------------------------------------------------------
// 2. 注册 API
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
  if (users.has(username)) return res.status(400).json({ error: '用户名已存在' });
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  users.set(username, { passwordHash });
  res.json({ success: true, message: '注册成功' });
});

// ---------------------------------------------------------------
// 3. 登录 API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
  const user = users.get(username);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  if (inputHash !== user.passwordHash) return res.status(401).json({ error: '密码错误' });
  res.json({ success: true });
});

// ---------------------------------------------------------------
// 4. 投屏框架
app.use('/games', express.static('games'));
app.use(express.static('public'));

app.get('/cast', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cast.html'));
});

app.get('/play/:gameName', (req, res) => {
  const gamePath = path.join(__dirname, 'games', req.params.gameName, 'index.html');
  if (!fs.existsSync(gamePath)) return res.status(404).send('Game not found');
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
    const castBtn = document.getElementById('castBtn');
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
      if (e.data.type === 'CAST_CANVAS_READY') startCast(e.source.castCanvas);
    });
    gameFrame.onload = () => injectScriptToIframe(gameFrame, '/inject.js');
  </script>
</body>
</html>
  `);
});

// ---------------------------------------------------------------
// 5. 兜底：所有未定义路由返回 JSON
app.use((req, res, next) => {
  if (req.accepts('json') && !req.accepts('html')) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

// ---------------------------------------------------------------
// 6. 启动服务器
const server = app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/ws-cast') {
    wss.handleUpgrade(req, socket, head, ws => {
      ws.roomId = searchParams.get('room') || 'default';
      ws.on('message', msg => {
        wss.clients.forEach(c => {
          if (c.roomId === ws.roomId && c !== ws && c.readyState === WebSocket.OPEN) c.send(msg);
        });
      });
    });
  }
});