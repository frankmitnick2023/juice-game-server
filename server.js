// server.js - Fixed for Railway
const express = require('express');
const path = require('path');

console.log('🚀 Starting FunX Platform...');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(express.json());
app.use(express.static('public'));

// 创建必要的文件夹
const fs = require('fs');
const folders = ['games', 'public', 'data'];
folders.forEach(folder => {
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
        console.log(`📁 Created ${folder} folder`);
    }
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ 
        status: 'running', 
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// 主页
app.get('/', (req, res) => {
    // 如果 public/index.html 存在就发送，否则发送简单页面
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>FunX Platform</title>
            <style>
                body { font-family: Arial; background: #1a1a1a; color: white; text-align: center; padding: 50px; }
                .container { max-width: 500px; margin: 0 auto; background: #2a2a2a; padding: 40px; border-radius: 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎮 FunX Platform</h1>
                <p>Server is running successfully!</p>
                <p>Add game files to the <code>games</code> folder.</p>
                <a href="/health" style="color: #4ecdc4;">Check Health</a>
            </div>
        </body>
        </html>
        `);
    }
});

// 启动服务器
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('✅ FunX Platform Started Successfully!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
    console.log('=================================');
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});