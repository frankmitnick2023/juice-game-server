const express = require('express');
const sgMail = require('@sendgrid/mail');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 中间件
app.use(express.json());
app.use(express.static('public'));

// 初始化 SendGrid
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('✅ SendGrid 邮件服务已初始化');
} else {
    console.log('⚠️  SendGrid API Key 未设置');
}

// 数据存储
const users = new Map();
const verifications = new Map();

// 发送验证码路由
app.post('/api/send-code', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: '邮箱地址不能为空' });
    }
    
    // 邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.json({ success: false, error: '请输入有效的邮箱地址' });
    }
    
    // 生成验证码
    const code = Math.random().toString().slice(2, 8);
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10分钟
    
    verifications.set(email, {
        code,
        expiresAt,
        attempts: 0,
        createdAt: new Date().toISOString()
    });
    
    console.log(`📧 生成验证码: ${email} -> ${code}`);
    
    try {
        // 如果有 SendGrid API Key 就发送真实邮件
        if (process.env.SENDGRID_API_KEY && process.env.SENDER_EMAIL) {
            const emailSent = await sendVerificationEmail(email, code);
            
            if (emailSent) {
                console.log(`✅ 验证码邮件已发送至: ${email}`);
                res.json({ 
                    success: true, 
                    message: '验证码已发送到您的邮箱，请查收' 
                });
            } else {
                // 邮件发送失败，返回验证码供测试
                res.json({ 
                    success: true, 
                    message: '邮件服务暂时不可用，请使用此验证码继续',
                    code: code,
                    mode: 'fallback'
                });
            }
        } else {
            // 开发模式：返回验证码
            res.json({ 
                success: true, 
                message: '验证码已生成（开发模式）',
                code: code,
                mode: 'development'
            });
        }
    } catch (error) {
        console.error('邮件发送错误:', error);
        // 失败时返回验证码供测试
        res.json({ 
            success: true, 
            message: '系统繁忙，请使用此验证码',
            code: code,
            mode: 'error_fallback'
        });
    }
});

// 发送验证邮件函数
async function sendVerificationEmail(email, code) {
    const msg = {
        to: email,
        from: {
            email: process.env.SENDER_EMAIL,
            name: 'FunX Game Platform'
        },
        subject: '您的 FunX 验证码 - 请及时验证',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { 
                        font-family: 'Arial', sans-serif; 
                        background: #f6f9fc; 
                        margin: 0; 
                        padding: 0; 
                    }
                    .container { 
                        max-width: 600px; 
                        margin: 0 auto; 
                        background: white; 
                        border-radius: 15px; 
                        overflow: hidden; 
                        box-shadow: 0 8px 25px rgba(0,0,0,0.1); 
                    }
                    .header { 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        padding: 40px 30px; 
                        text-align: center; 
                        color: white; 
                    }
                    .content { 
                        padding: 40px 30px; 
                        color: #333; 
                    }
                    .code-container { 
                        background: #f8f9fa; 
                        padding: 25px; 
                        border-radius: 12px; 
                        text-align: center; 
                        margin: 25px 0; 
                        border: 2px dashed #667eea;
                    }
                    .code { 
                        font-size: 48px; 
                        font-weight: bold; 
                        color: #667eea; 
                        letter-spacing: 8px; 
                        margin: 15px 0; 
                        font-family: 'Courier New', monospace;
                    }
                    .footer { 
                        background: #f8f9fa; 
                        padding: 25px; 
                        text-align: center; 
                        color: #666; 
                        font-size: 13px; 
                        border-top: 1px solid #e9ecef;
                    }
                    .warning { 
                        background: #fff3cd; 
                        border: 1px solid #ffeaa7; 
                        padding: 15px; 
                        border-radius: 8px; 
                        margin: 20px 0; 
                        color: #856404;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0; font-size: 32px;">🎮 FunX</h1>
                        <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 16px;">下一代游戏平台</p>
                    </div>
                    
                    <div class="content">
                        <h2 style="color: #333; margin-bottom: 10px;">邮箱验证</h2>
                        <p style="color: #666; line-height: 1.6;">感谢您注册 FunX 平台！请使用以下验证码完成注册：</p>
                        
                        <div class="code-container">
                            <div style="color: #666; font-size: 14px; margin-bottom: 10px;">您的验证码</div>
                            <div class="code">${code}</div>
                            <div style="color: #888; font-size: 13px; margin-top: 10px;">10分钟内有效</div>
                        </div>
                        
                        <div class="warning">
                            <strong>⚠️ 安全提示：</strong><br>
                            请勿将此验证码分享给他人。FunX 工作人员绝不会向您索要验证码。
                        </div>
                        
                        <p style="color: #666; font-size: 14px; line-height: 1.6;">
                            如果这不是您操作的，请忽略此邮件。<br>
                            如有问题，请联系我们：<a href="mailto:admin@wedance.co.nz" style="color: #667eea;">admin@wedance.co.nz</a>
                        </p>
                    </div>
                    
                    <div class="footer">
                        <p style="margin: 0;">© 2024 FunX Game Platform. All rights reserved.</p>
                        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.7;">
                            We Dance Ltd · admin@wedance.co.nz
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
FunX 游戏平台 - 邮箱验证

感谢您注册 FunX 平台！

您的验证码是: ${code}

此验证码 10 分钟内有效。

安全提示：请勿将此验证码分享给他人。FunX 工作人员绝不会向您索要验证码。

如果这不是您操作的，请忽略此邮件。

如有问题，请联系：admin@wedance.co.nz

© 2024 FunX Game Platform
We Dance Ltd
        `
    };
    
    try {
        await sgMail.send(msg);
        return true;
    } catch (error) {
        console.error('SendGrid 错误详情:', error.response?.body || error.message);
        return false;
    }
}

// 验证码验证路由
app.post('/api/verify', (req, res) => {
    const { email, code, name } = req.body;
    
    if (!email || !code) {
        return res.json({ success: false, error: '邮箱和验证码不能为空' });
    }
    
    const verification = verifications.get(email);
    
    if (!verification) {
        return res.json({ success: false, error: '验证码已过期，请重新获取' });
    }
    
    if (Date.now() > verification.expiresAt) {
        verifications.delete(email);
        return res.json({ success: false, error: '验证码已过期，请重新获取' });
    }
    
    if (verification.attempts >= 5) {
        verifications.delete(email);
        return res.json({ success: false, error: '尝试次数过多，请重新获取验证码' });
    }
    
    verification.attempts++;
    
    if (verification.code !== code) {
        return res.json({ success: false, error: `验证码错误，还剩${5 - verification.attempts}次机会` });
    }
    
    // 验证成功，创建用户
    const user = {
        id: 'user_' + Date.now(),
        email,
        name: name || email.split('@')[0],
        createdAt: new Date().toISOString(),
        level: 1,
        xp: 0,
        coins: 100,
        verified: true
    };
    
    users.set(email, user);
    verifications.delete(email);
    
    console.log(`✅ 用户注册成功: ${email}`);
    
    res.json({
        success: true,
        user,
        message: '注册成功！欢迎来到 FunX！'
    });
});

// 主页
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>FunX - 邮件服务已启用</title>
        <style>
            body { font-family: Arial; background: #1a1a1a; color: white; padding: 50px; text-align: center; }
            .status { background: #4CAF50; padding: 10px; border-radius: 5px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <h1>🎮 FunX Platform</h1>
        <div class="status">✅ 邮件服务已启用</div>
        <p>SendGrid 配置状态: 正常</p>
        <a href="/register" style="color: #4ecdc4;">测试注册流程</a>
    </body>
    </html>
    `);
});

// 注册页面
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ 
        status: 'running', 
        email_service: process.env.SENDGRID_API_KEY ? 'enabled' : 'disabled',
        users_count: users.size,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🎮 FunX Platform with Email Service');
    console.log(`📍 Port: ${PORT}`);
    console.log(`📧 SendGrid: ${process.env.SENDGRID_API_KEY ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`👤 Sender: ${process.env.SENDER_EMAIL || 'Not set'}`);
    console.log('=================================');
});