// server.js - 渐进式邮件集成
const express = require('express');
const path = require('path');

console.log('🚀 Starting FunX Platform with Email...');

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
        email_service: 'testing',
        users: users.size,
        timestamp: new Date().toISOString()
    });
});

// 智能邮件发送函数
async function sendVerificationEmail(email, code) {
    // 如果有 SendGrid 配置，尝试发送真实邮件
    if (process.env.SENDGRID_API_KEY && process.env.SENDER_EMAIL) {
        try {
            // 动态导入 SendGrid，避免启动时崩溃
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            
            const msg = {
                to: email,
                from: process.env.SENDER_EMAIL,
                subject: 'Your FunX Verification Code',
                text: `Your code: ${code}`,
                html: `<strong>${code}</strong>`
            };
            
            await sgMail.send(msg);
            console.log(`✅ 真实邮件发送成功: ${email}`);
            return { success: true, mode: 'real_email' };
            
        } catch (error) {
            console.log('❌ 真实邮件发送失败，使用备用方案:', error.message);
            return { success: false, error: error.message };
        }
    }
    
    // 备用方案：控制台模式
    console.log(`📧 控制台模式验证码: ${email} -> ${code}`);
    return { success: true, mode: 'console', code: code };
}

// 发送验证码路由
app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: 'Email is required' });
    }
    
    // 生成验证码
    const code = Math.random().toString().slice(2, 8);
    const expiresAt = Date.now() + 10 * 60 * 1000;
    
    verifications.set(email, {
        code,
        expiresAt,
        attempts: 0
    });
    
    // 发送邮件
    const result = await sendVerificationEmail(email, code);
    
    if (result.success) {
        if (result.mode === 'real_email') {
            res.json({ 
                success: true, 
                message: 'Verification code sent to your email' 
            });
        } else {
            res.json({ 
                success: true, 
                message: 'Verification code generated',
                code: result.code,
                mode: 'development'
            });
        }
    } else {
        // 邮件发送失败，返回验证码
        res.json({ 
            success: true, 
            message: 'Email service temporary unavailable',
            code: code,
            mode: 'fallback'
        });
    }
});

// 验证注册
app.post('/api/verify', (req, res) => {
    const { email, code, name } = req.body;
    
    if (!email || !code) {
        return res.json({ success: false, error: 'Email and code required' });
    }
    
    const verification = verifications.get(email);
    const isValid = verification ? verification.code === code : false;
    
    // 开发模式：也接受固定测试码
    if (isValid || code === '123456') {
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
        if (verification) verifications.delete(email);
        
        console.log(`✅ 用户注册成功: ${email}`);
        
        res.json({
            success: true,
            user,
            message: 'Registration successful!'
        });
    } else {
        res.json({ success: false, error: 'Invalid verification code' });
    }
});

// 主页 - 显示邮件服务状态
app.get('/', (req, res) => {
    const emailStatus = process.env.SENDGRID_API_KEY ? '✅ Enabled' : '⚠️ Console Mode';
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>FunX Platform</title>
        <style>
            body { font-family: Arial; background: #1a1a1a; color: white; padding: 50px; text-align: center; }
            .container { max-width: 500px; margin: 0 auto; background: #2a2a2a; padding: 40px; border-radius: 10px; }
            .btn { background: #007bff; color: white; padding: 15px 30px; border: none; border-radius: 5px; margin: 10px; cursor: pointer; text-decoration: none; display: inline-block; }
            .status { padding: 10px; border-radius: 5px; margin: 15px 0; }
            .enabled { background: #4CAF50; }
            .console { background: #FF9800; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎮 FunX Platform</h1>
            <div class="status ${process.env.SENDGRID_API_KEY ? 'enabled' : 'console'}">
                Email Service: ${emailStatus}
            </div>
            <p>测试验证码: <strong>123456</strong></p>
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
            .step { display: none; }
            .active { display: block; }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Register for FunX</h2>
            
            <div id="step1" class="step active">
                <input type="email" id="email" placeholder="Email" value="test@example.com">
                <input type="text" id="name" placeholder="Name (optional)" value="Test User">
                <button onclick="sendCode()">Send Verification Code</button>
            </div>
            
            <div id="step2" class="step">
                <p id="codeMessage">Enter the code sent to your email</p>
                <input type="text" id="code" placeholder="Verification Code">
                <button onclick="verifyCode()">Verify & Register</button>
                <button onclick="showStep(1)" style="background: #6c757d;">Back</button>
            </div>
        </div>
        
        <script>
            let currentEmail = '';
            
            function showStep(step) {
                document.getElementById('step1').classList.remove('active');
                document.getElementById('step2').classList.remove('active');
                document.getElementById('step' + step).classList.add('active');
            }
            
            async function sendCode() {
                const email = document.getElementById('email').value;
                const name = document.getElementById('name').value;
                
                if (!email) {
                    alert('Please enter email');
                    return;
                }
                
                currentEmail = email;
                
                try {
                    const response = await fetch('/api/send-code', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        if (data.code) {
                            document.getElementById('codeMessage').innerHTML = 
                                `Verification code: <strong>${data.code}</strong>`;
                        }
                        showStep(2);
                    } else {
                        alert('Error: ' + data.error);
                    }
                } catch (error) {
                    alert('Network error');
                }
            }
            
            async function verifyCode() {
                const code = document.getElementById('code').value;
                const name = document.getElementById('name').value;
                
                if (!code) {
                    alert('Please enter verification code');
                    return;
                }
                
                try {
                    const response = await fetch('/api/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: currentEmail,
                            code: code,
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
                } catch (error) {
                    alert('Network error');
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
    console.log('✅ FunX Platform with Smart Email');
    console.log(`📍 Port: ${PORT}`);
    console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? 'Enabled' : 'Console Mode'}`);
    console.log('=================================');
});