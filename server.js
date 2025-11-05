// server.js
// ---------------------------------------------------------------
// 1. 基础依赖
// ---------------------------------------------------------------
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const WebSocket = require('ws');

const app = express();

// ---------------------------------------------------------------
// 2. 你的原有中间件 / 路由 / 数据库等（全部保留）
// ---------------------------------------------------------------
// 请把原来的代码粘贴到这里，例如：
// app.use(express.json());
// app.use('/api', yourApiRouter);
// app.use(session(...));
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// 3. 投屏框架：静态资源
// ---------------------------------------------------------------
app.use('/games', express.static('games'));   // 所有游戏
app.use(express.static('public'));            // cast.html、inject.js

// ---------------------------------------------------------------
// 4. 通用大屏投屏页
// ---------------------------------------------------------------
app.get('/cast', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cast.html'));
});

// ---------------------------------------------------------------
// 5. 通用游戏播放页（自动注入投屏）
// ---------------------------------------------------------------
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

    // 把 inject.js 注入 iframe
    function injectScriptToIframe(iframe, src) {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const script = doc.createElement('script');
      script.src = src;
      script.onload = () => console.log('inject.js loaded');
      doc.head.appendChild(script);
    }

    // 开始投屏
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

    // 接收 iframe 发来的 canvas 就绪消息
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
// 6. 启动 HTTP + WebSocket
// ---------------------------------------------------------------
const server = app.listen(process.env.PORT || 3000);
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