// server.js - 超稳定版本（无邮件依赖）
const express = require('express');
const path = require('path');

console.log('🚀 Starting FunX Platform...');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(express.json());
app.use(express.static('public'));

// 数据存储
const users = new Map();
const verifications = new Map();

// 健康检查
app.get('/health', (req, res) => {
    res.json({ 
        status: 'running', 
        message: 'FunX Platform is working!',
        users: users.size,
        timestamp: new Date().toISOString()
    });
});

// 发送验证码（控制台模式）
app.post('/api/send-code', (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: 'Email is required' });
    }
    
    // 生成验证码
    const code = '123456'; // 固定测试验证码
    const expiresAt = Date.now() + 10 * 60 * 1000;
    
    verifications.set(email, {
        code,
        expiresAt,
        attempts: 0
    });
    
    console.log(`📧 验证码 for ${email}: ${code}`);
    
    res.json({ 
        success: true, 
        message: '验证码已生成（测试模式）',
        code: code
    });
});

// 验证注册
app.post('/api/verify', (req, res) => {
    const { email, code, name } = req.body;
    
    if (!email || !code) {
        return res.json({ success: false, error: 'Email and code required' });
    }
    
    // 开发模式：任何6位数字都通过
    if (code && code.length === 6) {
        const user = {
            id: 'user_' + Date.now(),
            email,
            name: name || email.split('@')[0],
            createdAt: new Date().toISOString(),
            level: 1,
            xp: 0,
            verified: true
        };
        
        users.set(email, user);
        console.log(`✅ 用户注册成功: ${email}`);
        
        res.json({
            success: true,
            user,
            message: 'Registration successful!'
        });
    } else {
        res.json({ success: false, error: 'Please enter 6-digit code' });
    }
});

// 主页
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>FunX Platform</title>
        <style>
            body { font-family: Arial; background: #1a1a1a; color: white; padding: 50px; text-align: center; }
            .container { max-width: 500px; margin: 0 auto; background: #2a2a2a; padding: 40px; border-radius: 10px; }
            .btn { background: #007bff; color: white; padding: 15px 30px; border: none; border-radius: 5px; margin: 10px; cursor: pointer; text-decoration: none; display: inline-block; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎮 FunX Platform</h1>
            <p>Server is running successfully!</p>
            <p><strong>测试验证码: 123456</strong></p>
            <div>
                <a href="/register" class="btn">Register</a>
                <a href="/health" class="btn">Health Check</a>
            </div>
        </div>
    </body>
    </html>
    `);
});

// 注册页面
app.get('/register', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Register - FunX</title>
        <style>
            body { font-family: Arial; background: #1a1a1a; color: white; padding: 50px; }
            .container { max-width: 400px; margin: 0 auto; background: #2a2a2a; padding: 30px; border-radius: 10px; }
            input, button { width: 100%; padding: 12px; margin: 8px 0; border: none; border-radius: 5px; }
            button { background: #007bff; color: white; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Register for FunX</h2>
            <p><strong>Use verification code: 123456</strong></p>
            <input type="email" id="email" placeholder="Email" value="test@example.com">
            <input type="text" id="name" placeholder="Name (optional)" value="Test User">
            <button onclick="register()">Register Now</button>
        </div>
        <script>
            async function register() {
                const email = document.getElementById('email').value;
                const name = document.getElementById('name').value;
                
                const response = await fetch('/api/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: email,
                        code: '123456',
                        name: name
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    alert('Registration successful!');
                    localStorage.setItem('funx_user', JSON.stringify(data.user));
                    window.location.href = '/';
                } else {
                    alert('Error: ' + data.error);
                }
            }
        </script>
    </body>
    </html>
    `);
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('✅ FunX Platform Started!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 URL: http://0.0.0.0:${PORT}`);
    console.log('=================================');
});