// server.js - FunX Platform (Clean Version)
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting FunX Platform...');

const app = express();
const server = http.createServer(app);

// Configuration
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Simple in-memory storage (in production, use Redis or database)
const users = new Map();
const verifications = new Map();

// Utility functions
const utils = {
    generateCode() {
        return Math.random().toString().slice(2, 8);
    },
    
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },
    
    safeReadJSON(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (error) {
            console.error('Error reading file:', filePath, error);
        }
        return {};
    },
    
    safeWriteJSON(filePath, data) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Error writing file:', filePath, error);
            return false;
        }
    }
};

// Load existing users
try {
    const usersFile = path.join(DATA_DIR, 'users.json');
    const usersData = utils.safeReadJSON(usersFile);
    Object.entries(usersData).forEach(([email, user]) => {
        users.set(email, user);
    });
    console.log(`📊 Loaded ${users.size} existing users`);
} catch (error) {
    console.log('No existing users found');
}

// Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        users: users.size,
        timestamp: new Date().toISOString() 
    });
});

// Send verification code
app.post('/api/send-code', (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: 'Email is required' });
    }
    
    if (!utils.isValidEmail(email)) {
        return res.json({ success: false, error: 'Invalid email format' });
    }
    
    // Generate verification code
    const code = utils.generateCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    verifications.set(email, {
        code,
        expiresAt,
        attempts: 0
    });
    
    console.log(`📧 Verification code for ${email}: ${code}`);
    
    res.json({ 
        success: true, 
        message: 'Verification code sent',
        code: code // Remove in production
    });
});

// Verify code and register
app.post('/api/verify', (req, res) => {
    const { email, code, name } = req.body;
    
    if (!email || !code) {
        return res.json({ success: false, error: 'Email and code are required' });
    }
    
    const verification = verifications.get(email);
    
    if (!verification) {
        return res.json({ success: false, error: 'No verification request found' });
    }
    
    if (Date.now() > verification.expiresAt) {
        verifications.delete(email);
        return res.json({ success: false, error: 'Verification code expired' });
    }
    
    if (verification.attempts >= 3) {
        verifications.delete(email);
        return res.json({ success: false, error: 'Too many attempts' });
    }
    
    verification.attempts++;
    
    if (verification.code !== code) {
        return res.json({ success: false, error: 'Invalid verification code' });
    }
    
    // Code verified - create user
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
    
    // Save to file
    const usersFile = path.join(DATA_DIR, 'users.json');
    const usersObject = Object.fromEntries(users);
    utils.safeWriteJSON(usersFile, usersObject);
    
    // Clean up verification
    verifications.delete(email);
    
    console.log(`✅ New user registered: ${email}`);
    
    res.json({
        success: true,
        user,
        message: 'Registration successful!'
    });
});

// Check if email is registered
app.post('/api/check-email', (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: 'Email is required' });
    }
    
    const exists = users.has(email);
    
    res.json({
        success: true,
        exists,
        message: exists ? 'Email already registered' : 'Email available'
    });
});

// Get user profile
app.get('/api/user/:email', (req, res) => {
    const { email } = req.params;
    const user = users.get(email);
    
    if (!user) {
        return res.json({ success: false, error: 'User not found' });
    }
    
    res.json({ success: true, user });
});

// Home page
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>FunX - Welcome</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                padding: 40px;
                border-radius: 20px;
                text-align: center;
                max-width: 400px;
                width: 100%;
            }
            .logo {
                font-size: 4rem;
                margin-bottom: 1rem;
            }
            h1 {
                font-size: 2.5rem;
                margin-bottom: 0.5rem;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .btn {
                display: inline-block;
                background: #ff6b6b;
                color: white;
                padding: 15px 30px;
                border-radius: 10px;
                text-decoration: none;
                font-size: 1.1rem;
                margin: 10px;
                transition: transform 0.2s;
                border: none;
                cursor: pointer;
            }
            .btn:hover {
                transform: translateY(-2px);
            }
            .btn-secondary {
                background: #4ecdc4;
            }
            .stats {
                margin: 20px 0;
                opacity: 0.8;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">🎮</div>
            <h1>FunX</h1>
            <p>Next Generation Gaming Platform</p>
            
            <div class="stats">
                <p>${users.size} users registered</p>
            </div>
            
            <div style="margin: 30px 0;">
                <a href="/register" class="btn">Get Started</a>
                <a href="/login" class="btn btn-secondary">Login</a>
            </div>
            
            <div style="margin-top: 20px; font-size: 0.9rem; opacity: 0.7;">
                <p>Secure • Fast • Fun</p>
            </div>
        </div>
    </body>
    </html>
    `);
});

// Registration page
app.get('/register', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Register - FunX</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                padding: 40px;
                border-radius: 20px;
                max-width: 400px;
                width: 100%;
            }
            .back-btn {
                color: white;
                text-decoration: none;
                margin-bottom: 20px;
                display: inline-block;
            }
            h1 {
                margin-bottom: 30px;
                text-align: center;
            }
            .form-group {
                margin-bottom: 20px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                font-weight: 500;
            }
            input {
                width: 100%;
                padding: 12px;
                border: none;
                border-radius: 8px;
                background: rgba(255,255,255,0.9);
                font-size: 16px;
            }
            .btn {
                width: 100%;
                padding: 15px;
                background: #ff6b6b;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                margin: 10px 0;
            }
            .btn:disabled {
                background: #6c757d;
                cursor: not-allowed;
            }
            .step {
                display: none;
            }
            .step.active {
                display: block;
            }
            .message {
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
                text-align: center;
            }
            .error { background: rgba(255,107,107,0.2); }
            .success { background: rgba(78,205,196,0.2); }
        </style>
    </head>
    <body>
        <div class="container">
            <a href="/" class="back-btn">← Back</a>
            <h1>Join FunX</h1>
            
            <div id="message" class="message" style="display: none;"></div>
            
            <!-- Step 1: Email -->
            <div id="step1" class="step active">
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input type="email" id="email" placeholder="your@email.com" required>
                </div>
                <div class="form-group">
                    <label for="name">Display Name (Optional)</label>
                    <input type="text" id="name" placeholder="What should we call you?">
                </div>
                <button class="btn" onclick="sendCode()">Send Verification Code</button>
            </div>
            
            <!-- Step 2: Verification -->
            <div id="step2" class="step">
                <div class="form-group">
                    <label for="code">Verification Code</label>
                    <input type="text" id="code" placeholder="Enter 6-digit code" maxlength="6">
                </div>
                <button class="btn" onclick="verifyCode()">Verify & Register</button>
                <button class="btn" onclick="showStep(1)" style="background: #6c757d;">Back</button>
            </div>
            
            <!-- Step 3: Success -->
            <div id="step3" class="step">
                <div style="text-align: center; padding: 20px 0;">
                    <div style="font-size: 4rem; margin-bottom: 20px;">🎉</div>
                    <h2>Welcome to FunX!</h2>
                    <p>Your account has been created successfully.</p>
                    <button class="btn" onclick="goToDashboard()">Continue to Dashboard</button>
                </div>
            </div>
        </div>

        <script>
            let currentEmail = '';
            let currentName = '';
            
            function showMessage(text, type) {
                const messageEl = document.getElementById('message');
                messageEl.textContent = text;
                messageEl.className = 'message ' + type;
                messageEl.style.display = 'block';
            }
            
            function hideMessage() {
                document.getElementById('message').style.display = 'none';
            }
            
            function showStep(stepNumber) {
                hideMessage();
                document.querySelectorAll('.step').forEach(step => {
                    step.classList.remove('active');
                });
                document.getElementById('step' + stepNumber).classList.add('active');
            }
            
            async function sendCode() {
                const email = document.getElementById('email').value;
                const name = document.getElementById('name').value;
                
                if (!email) {
                    showMessage('Please enter your email address', 'error');
                    return;
                }
                
                currentEmail = email;
                currentName = name;
                
                try {
                    const response = await fetch('/api/send-code', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        showMessage('Verification code sent! Check console: ' + data.code, 'success');
                        showStep(2);
                    } else {
                        showMessage(data.error, 'error');
                    }
                } catch (error) {
                    showMessage('Network error. Please try again.', 'error');
                }
            }
            
            async function verifyCode() {
                const code = document.getElementById('code').value;
                
                if (!code) {
                    showMessage('Please enter the verification code', 'error');
                    return;
                }
                
                try {
                    const response = await fetch('/api/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: currentEmail,
                            code: code,
                            name: currentName
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        localStorage.setItem('funx_user', JSON.stringify(data.user));
                        showStep(3);
                    } else {
                        showMessage(data.error, 'error');
                    }
                } catch (error) {
                    showMessage('Network error. Please try again.', 'error');
                }
            }
            
            function goToDashboard() {
                window.location.href = '/dashboard';
            }
            
            // Enter key support
            document.getElementById('email').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') sendCode();
            });
            
            document.getElementById('code').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') verifyCode();
            });
        </script>
    </body>
    </html>
    `);
});

// Login page
app.get('/login', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Login - FunX</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                padding: 40px;
                border-radius: 20px;
                max-width: 400px;
                width: 100%;
                text-align: center;
            }
            .btn {
                display: block;
                width: 100%;
                background: #ff6b6b;
                color: white;
                padding: 15px;
                border-radius: 10px;
                text-decoration: none;
                margin: 10px 0;
                border: none;
                cursor: pointer;
                font-size: 16px;
            }
            .message {
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
            }
            .error { background: rgba(255,107,107,0.2); }
        </style>
    </head>
    <body>
        <div class="container">
            <div style="font-size: 3rem; margin-bottom: 20px;">🔐</div>
            <h1>Login to FunX</h1>
            <p style="margin-bottom: 30px; opacity: 0.8;">Enter your email to continue</p>
            
            <div id="message" class="message" style="display: none;"></div>
            
            <input type="email" id="email" placeholder="your@email.com" style="
                width: 100%;
                padding: 12px;
                border: none;
                border-radius: 8px;
                margin-bottom: 20px;
                font-size: 16px;
            ">
            
            <button class="btn" onclick="login()">Send Login Code</button>
            <a href="/register" class="btn" style="background: #4ecdc4;">Create Account</a>
            <a href="/" style="color: white; margin-top: 20px; display: block;">← Back to Home</a>
        </div>

        <script>
            function showMessage(text, type) {
                const messageEl = document.getElementById('message');
                messageEl.textContent = text;
                messageEl.className = 'message ' + type;
                messageEl.style.display = 'block';
            }
            
            async function login() {
                const email = document.getElementById('email').value;
                
                if (!email) {
                    showMessage('Please enter your email', 'error');
                    return;
                }
                
                try {
                    const response = await fetch('/api/send-code', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        showMessage('Login code sent! Check console: ' + data.code, 'success');
                        // In real app, you'd show verification step
                        setTimeout(() => {
                            alert('In a real app, you would verify the code here');
                        }, 1000);
                    } else {
                        showMessage(data.error, 'error');
                    }
                } catch (error) {
                    showMessage('Network error', 'error');
                }
            }
            
            document.getElementById('email').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') login();
            });
        </script>
    </body>
    </html>
    `);
});

// Dashboard (placeholder)
app.get('/dashboard', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Dashboard - FunX</title>
        <style>
            body { 
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                margin: 0;
                padding: 20px;
                text-align: center;
            }
            .container { max-width: 600px; margin: 0 auto; }
            .btn { 
                background: #ff6b6b; 
                color: white; 
                padding: 10px 20px; 
                border-radius: 8px; 
                text-decoration: none; 
                margin: 10px; 
                display: inline-block;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎮 FunX Dashboard</h1>
            <p>Welcome to your dashboard!</p>
            <div style="margin: 30px 0;">
                <a href="/" class="btn">Home</a>
                <a href="/register" class="btn">Add Another Account</a>
            </div>
            <div id="userInfo" style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin: 20px 0;"></div>
        </div>
        
        <script>
            const userData = localStorage.getItem('funx_user');
            if (userData) {
                const user = JSON.parse(userData);
                document.getElementById('userInfo').innerHTML = \`
                    <h3>Welcome, \${user.name}!</h3>
                    <p>Email: \${user.email}</p>
                    <p>Level: \${user.level} | XP: \${user.xp}</p>
                    <p>Member since: \${new Date(user.createdAt).toLocaleDateString()}</p>
                \`;
            } else {
                document.getElementById('userInfo').innerHTML = '<p>No user data found. <a href="/register" style="color: #4ecdc4;">Register first</a></p>';
            }
        </script>
    </body>
    </html>
    `);
});

// Start server
server.listen(PORT, () => {
    console.log('=================================');
    console.log('🎮 FunX Platform Running!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`👤 Users: ${users.size}`);
    console.log(`🌐 Home: http://localhost:${PORT}/`);
    console.log('=================================');
});