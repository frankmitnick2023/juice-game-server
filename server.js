// server.js —— 完整可运行（登录 + 游戏 + 投屏 全在一个页面）
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const WebSocket = require('ws');
const crypto    = require('crypto');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------
// 1. 内存用户系统
const users = new Map();
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
// 4. 静态资源
app.use('/games', express.static('games'));
app.use(express.static('public'));

// ---------------------------------------------------------------
// 5. 投屏大屏页
app.get('/cast', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cast.html'));
});

// ---------------------------------------------------------------
// 6. 主页：登录 + 游戏 + 投屏
app.get('/', (req, res) => {
  const room = 'room-' + Date.now();
  res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Juice Game</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial;background:#111;color:#fff;margin:0;height:100vh;overflow:hidden;}
    .login-box,.game-box{background:#222;padding:2rem;border-radius:12px;width:300px;text-align:center;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);}
    input,button{display:block;width:100%;margin:0.5rem 0;padding:0.8rem;border:none;border-radius:8px;}
    button{background:#a855f7;color:#fff;font-weight:bold;cursor:pointer;}
    button:hover{background:#9333ea;}
    a{color:#a855f7;text-decoration:underline;}
    #gameFrame{width:100%;height:100%;border:none;display:none;}
    #castBtn{position:fixed;bottom:20px;right:20px;padding:12px 20px;
             background:#a855f7;color:#fff;border:none;border-radius:8px;
             font-weight:bold;z-index:9999;display:none;}
  </style>
</head>
<body>

  <!-- 登录/注册 -->
  <div id="authBox" class="login-box">
    <h2>登录</h2>
    <form id="loginForm">
      <input type="text" id="username" placeholder="用户名" required>
      <input type="password" id="password" placeholder="密码" required>
      <button type="submit">登录</button>
    </form>
    <p><a href="#" id="showRegister">没有账号？点这里注册</a></p>

    <form id="registerForm" style="display:none;margin-top:1rem;">
      <input type="text" id="regUsername" placeholder="新用户名" required>
      <input type="password" id="regPassword" placeholder="新密码" required>
      <button type="submit">注册</button>
    </form>
  </div>

  <!-- 游戏 + 投屏 -->
  <iframe id="gameFrame" src="/games/dance-cam/index.html" sandbox="allow-scripts allow-same-origin"></iframe>
  <button id="castBtn">投屏到大屏</button>

  <script src="/inject.js"></script>
  <script>
    const room = '${room}';
    const gameFrame = document.getElementById('gameFrame');
    const castBtn = document.getElementById('castBtn');
    const authBox = document.getElementById('authBox');
    let pc, ws;

    // 登录/注册逻辑
    document.getElementById('showRegister').onclick = e => {
      e.preventDefault();
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('registerForm').style.display = 'block';
    };

    document.getElementById('loginForm').onsubmit = async e => {
      e.preventDefault();
      await auth('/api/login', { username: document.getElementById('username').value, password: document.getElementById('password').value }, '登录成功！');
    };

    document.getElementById('registerForm').onsubmit = async e => {
      e.preventDefault();
      await auth('/api/register', { username: document.getElementById('regUsername').value, password: document.getElementById('regPassword').value }, '注册成功！请登录');
    };

    async function auth(url, body, successMsg) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        alert(successMsg);
        authBox.style.display = 'none';
        gameFrame.style.display = 'block';
        castBtn.style.display = 'block';
        injectScriptToIframe(gameFrame, '/inject.js');
      } else {
        alert(data.error || '操作失败');
      }
    }

    // 投屏逻辑
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
          window.open('/cast?room=' + room, '_blank');
        }
      };
    }

    window.addEventListener('message', e => {
      if (e.data.type === 'CAST_CANVAS_READY') startCast(e.source.castCanvas);
    });

    castBtn.onclick = () => {
      if (ws) window.open('/cast?room=' + room, '_blank');
    };
  </script>
</body>
</html>
  `);
});

// ---------------------------------------------------------------
// 7. 启动服务器
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