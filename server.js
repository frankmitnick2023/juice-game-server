// server.js - FunX Game Platform
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting FunX Game Platform...');

// ==================== Initialize App ====================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ==================== Configuration ====================
const PORT = process.env.PORT || 8080;
const GAMES_DIR = path.join(__dirname, 'games');
const DATA_DIR = path.join(__dirname, 'data');
const MANIFEST_FILE = path.join(GAMES_DIR, 'game-manifest.json');

// ==================== Data Storage ====================
const players = new Map();
let games = [];
let onlinePlayers = new Map();

// ==================== Core Modules ====================

/**
 * Game Manager
 */
const gameManager = {
    loadGamesManifest() {
        try {
            if (fs.existsSync(MANIFEST_FILE)) {
                const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
                console.log(`🎮 Loaded ${manifest.games.length} games`);
                return manifest.games;
            }
        } catch (error) {
            console.error('❌ Failed to load game manifest:', error);
        }
        
        return this.scanGamesDirectory();
    },

    scanGamesDirectory() {
        const games = [];
        
        try {
            if (!fs.existsSync(GAMES_DIR)) {
                fs.mkdirSync(GAMES_DIR, { recursive: true });
                console.log('📁 Created games directory');
                return games;
            }
            
            const files = fs.readdirSync(GAMES_DIR);
            const htmlFiles = files.filter(file => file.endsWith('.html'));
            
            console.log(`🔍 Found ${htmlFiles.length} HTML game files`);
            
            htmlFiles.forEach(file => {
                const gameId = path.basename(file, '.html');
                const game = {
                    id: gameId,
                    file: file,
                    title: this.formatGameTitle(gameId),
                    description: 'An exciting game experience',
                    icon: '🎮',
                    version: 'v1.0',
                    category: 'General',
                    tags: ['Game'],
                    difficulty: 'Easy',
                    duration: 'Unknown',
                    players: '1 Player'
                };
                games.push(game);
            });
            
        } catch (error) {
            console.error('❌ Failed to scan games directory:', error);
        }
        
        return games;
    },

    formatGameTitle(gameId) {
        return gameId
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    },

    reloadGames() {
        games = this.loadGamesManifest();
        console.log('🔄 Games reloaded:', games.map(g => g.title));
        return games;
    },

    getGameById(gameId) {
        return games.find(game => game.id === gameId);
    },

    getGameFilePath(gameId) {
        const game = this.getGameById(gameId);
        return game ? path.join(GAMES_DIR, game.file) : null;
    }
};

/**
 * Email Verification System
 */
const emailService = {
    // Send verification code
    async sendVerificationCode(email) {
        const code = Math.random().toString().slice(2, 8); // 6-digit code
        const expiration = Date.now() + 10 * 60 * 1000; // 10 minutes
        
        // Store verification data
        const verificationData = {
            email: email,
            code: code,
            expiresAt: expiration,
            attempts: 0,
            createdAt: new Date().toISOString()
        };
        
        const verifyFile = path.join(DATA_DIR, 'verifications.json');
        this.ensureDataDir();
        
        let verifications = {};
        if (fs.existsSync(verifyFile)) {
            verifications = JSON.parse(fs.readFileSync(verifyFile, 'utf8'));
        }
        
        verifications[email] = verificationData;
        fs.writeFileSync(verifyFile, JSON.stringify(verifications, null, 2));
        
        // In production, integrate with email service like SendGrid
        console.log(`📧 Verification code sent to ${email}: ${code}`);
        
        return { 
            success: true, 
            message: 'Verification code sent to your email',
            code: code // Remove this in production
        };
    },
    
    // Verify code
    async verifyCode(email, code) {
        const verifyFile = path.join(DATA_DIR, 'verifications.json');
        if (!fs.existsSync(verifyFile)) {
            return { success: false, error: 'No verification request found' };
        }
        
        const verifications = JSON.parse(fs.readFileSync(verifyFile, 'utf8'));
        const data = verifications[email];
        
        if (!data) {
            return { success: false, error: 'No verification request for this email' };
        }
        
        if (Date.now() > data.expiresAt) {
            delete verifications[email];
            fs.writeFileSync(verifyFile, JSON.stringify(verifications, null, 2));
            return { success: false, error: 'Verification code expired' };
        }
        
        if (data.attempts >= 5) {
            return { success: false, error: 'Too many attempts. Please request a new code.' };
        }
        
        data.attempts += 1;
        fs.writeFileSync(verifyFile, JSON.stringify(verifications, null, 2));
        
        if (data.code === code) {
            // Verification successful, remove the code
            delete verifications[email];
            fs.writeFileSync(verifyFile, JSON.stringify(verifications, null, 2));
            return { success: true, message: 'Email verified successfully' };
        } else {
            return { success: false, error: 'Invalid verification code' };
        }
    },
    
    ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }
};

/**
 * User Authentication & Safety System
 */
const authManager = {
    USER_DB: path.join(DATA_DIR, 'users.json'),
    
    initUserDB() {
        emailService.ensureDataDir();
        if (!fs.existsSync(this.USER_DB)) {
            fs.writeFileSync(this.USER_DB, JSON.stringify({ users: [] }));
        }
    },
    
    // User registration with email verification
    async registerUser(userData) {
        this.initUserDB();
        const db = JSON.parse(fs.readFileSync(this.USER_DB, 'utf8'));
        
        // Check if user already exists
        const existingUser = db.users.find(u => u.email === userData.email);
        if (existingUser) {
            return { 
                success: false, 
                error: 'User already exists with this email' 
            };
        }
        
        // Create new user
        const newUser = {
            id: 'funx_' + Date.now(),
            email: userData.email,
            name: userData.name || userData.email.split('@')[0],
            verified: true, // Mark as verified since we verified email
            level: 1,
            xp: 0,
            coins: 100, // Starting bonus
            safetyAgreed: userData.agreeSafety,
            safetyAgreedAt: new Date().toISOString(),
            registeredAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            gamesPlayed: 0,
            totalScore: 0
        };
        
        db.users.push(newUser);
        fs.writeFileSync(this.USER_DB, JSON.stringify(db, null, 2));
        
        console.log('👤 New user registered:', newUser.email);
        return { success: true, user: newUser };
    },
    
    // Find user by email
    findUserByEmail(email) {
        this.initUserDB();
        const db = JSON.parse(fs.readFileSync(this.USER_DB, 'utf8'));
        return db.users.find(u => u.email === email);
    },
    
    // Update user data
    updateUser(userId, updates) {
        this.initUserDB();
        const db = JSON.parse(fs.readFileSync(this.USER_DB, 'utf8'));
        const userIndex = db.users.findIndex(u => u.id === userId);
        
        if (userIndex !== -1) {
            db.users[userIndex] = { ...db.users[userIndex], ...updates };
            fs.writeFileSync(this.USER_DB, JSON.stringify(db, null, 2));
            return db.users[userIndex];
        }
        return null;
    },
    
    // Get all users (for leaderboard)
    getAllUsers() {
        this.initUserDB();
        const db = JSON.parse(fs.readFileSync(this.USER_DB, 'utf8'));
        return db.users.sort((a, b) => b.xp - a.xp); // Sort by XP
    }
};

/**
 * Safety Agreement System
 */
const safetyManager = {
    SAFETY_AGREEMENT: `
    FunX Safety Agreement & Disclaimer

    IMPORTANT: Please read this safety agreement carefully

    1. Safety Requirements
    - Ensure adequate space for movement (at least 2x2 meters)
    - Wear appropriate sportswear and non-slip shoes
    - Warm up properly before playing
    - Stop immediately if you feel unwell

    2. Movement Guidelines
    - Follow game instructions carefully
    - Do not overexert yourself beyond your physical limits
    - Be aware of your surroundings to avoid collisions

    3. Health Declaration
    - Confirm you have no heart conditions, high blood pressure, or other medical conditions unsuitable for physical activity
    - Pregnant women, individuals with osteoporosis should consult doctors before playing

    4. Disclaimer
    - FunX is not liable for injuries resulting from failure to follow safety guidelines
    - Equipment or network issues are subject to relevant laws and regulations
    - Minors should use under guardian supervision

    By agreeing, I confirm I have read and understood this safety agreement, acknowledge the risks involved, and promise to follow all safety guidelines.
    `,

    recordAgreement(userId, email, userAgent) {
        const agreementFile = path.join(DATA_DIR, 'safety_agreements.json');
        emailService.ensureDataDir();
        
        let agreements = [];
        if (fs.existsSync(agreementFile)) {
            agreements = JSON.parse(fs.readFileSync(agreementFile, 'utf8'));
        }
        
        agreements.push({
            userId: userId,
            email: email,
            agreedAt: new Date().toISOString(),
            userAgent: userAgent
        });
        
        fs.writeFileSync(agreementFile, JSON.stringify(agreements, null, 2));
    }
};

// ==================== API Routes ====================

/**
 * Health Check
 */
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'FunX Server Running',
        gamesCount: games.length,
        onlinePlayers: onlinePlayers.size,
        timestamp: new Date().toISOString()
    });
});

/**
 * Send Verification Code
 */
app.post('/api/send-verification', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: 'Email is required' });
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.json({ success: false, error: 'Please enter a valid email address' });
    }
    
    try {
        const result = await emailService.sendVerificationCode(email);
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: 'Failed to send verification code' });
    }
});

/**
 * Complete Registration
 */
app.post('/api/register', async (req, res) => {
    const { email, name, verificationCode, agreeSafety } = req.body;
    
    // Validate required fields
    if (!email || !verificationCode || !agreeSafety) {
        return res.json({ 
            success: false, 
            error: 'All fields are required' 
        });
    }
    
    try {
        // Verify email code
        const verifyResult = await emailService.verifyCode(email, verificationCode);
        if (!verifyResult.success) {
            return res.json(verifyResult);
        }
        
        // Record safety agreement
        safetyManager.recordAgreement('temp_id', email, req.get('User-Agent'));
        
        // Create user account
        const registrationResult = await authManager.registerUser({
            email,
            name,
            agreeSafety
        });
        
        if (!registrationResult.success) {
            return res.json(registrationResult);
        }
        
        // Record final safety agreement with user ID
        safetyManager.recordAgreement(registrationResult.user.id, email, req.get('User-Agent'));
        
        console.log(`🎉 New FunX user: ${email}`);
        
        res.json({
            success: true,
            user: registrationResult.user,
            message: 'Welcome to FunX! Registration successful.',
            redirect: '/lobby'
        });
        
    } catch (error) {
        res.json({ 
            success: false, 
            error: 'Registration failed: ' + error.message 
        });
    }
});

/**
 * Get Games List
 */
app.get('/api/games', (req, res) => {
    res.json({
        success: true,
        games: games.map(game => ({
            id: game.id,
            title: game.title,
            description: game.description,
            icon: game.icon,
            version: game.version,
            category: game.category,
            tags: game.tags,
            difficulty: game.difficulty,
            duration: game.duration,
            players: game.players,
            color: game.color,
            comingSoon: game.comingSoon || false
        }))
    });
});

/**
 * Leaderboard API
 */
app.get('/api/leaderboard', (req, res) => {
    const users = authManager.getAllUsers();
    const leaderboard = users.slice(0, 50).map((user, index) => ({
        rank: index + 1,
        name: user.name,
        xp: user.xp,
        level: user.level,
        gamesPlayed: user.gamesPlayed
    }));
    
    res.json({
        success: true,
        leaderboard: leaderboard
    });
});

// ==================== Page Routes ====================

/**
 * Home Page
 */
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>FunX - Game Platform</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: Arial, sans-serif; 
                text-align: center; 
                padding: 50px; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
                min-height: 100vh; 
                margin: 0;
            }
            .container { 
                max-width: 600px; 
                margin: 0 auto; 
                background: rgba(255,255,255,0.1); 
                padding: 40px; 
                border-radius: 20px; 
                backdrop-filter: blur(10px);
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            }
            .logo {
                font-size: 4em;
                margin-bottom: 20px;
            }
            .brand-name {
                font-size: 3em;
                font-weight: bold;
                margin-bottom: 10px;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .btn { 
                display: inline-block; 
                padding: 15px 30px; 
                background: #ff6b6b; 
                color: white; 
                text-decoration: none; 
                border-radius: 10px; 
                margin: 10px; 
                transition: all 0.3s ease; 
                font-size: 16px;
                border: none;
                cursor: pointer;
            }
            .btn:hover { 
                background: #ff5252; 
                transform: scale(1.05); 
            }
            .btn-secondary {
                background: #4ecdc4;
            }
            .btn-secondary:hover {
                background: #26a69a;
            }
            .stats {
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 10px;
                margin: 20px 0;
            }
            h1 {
                font-size: 2.5em;
                margin-bottom: 20px;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">🎮</div>
            <div class="brand-name">FunX</div>
            <p>Next Generation Game Platform</p>
            
            <div class="stats">
                <p>🎯 Smart Game Management</p>
                <p>• Auto-detect New Games</p>
                <p>• No Server Code Changes Needed</p>
                <p>• Dynamic Game Library</p>
            </div>
            
            <p>Currently featuring <strong>${games.length}</strong> amazing games</p>
            
            <div style="margin: 30px 0;">
                <a href="/register" class="btn">Get Started</a>
                <a href="/lobby" class="btn btn-secondary">Game Lobby</a>
                <a href="/health" class="btn">Server Status</a>
            </div>
            
            <div style="margin-top: 30px; padding: 20px; background: rgba(255,255,255,0.1); border-radius: 10px;">
                <h3>📁 Add New Games</h3>
                <p>Simply drop HTML game files into the <code>games</code> folder</p>
                <p>They will be automatically detected and added to the lobby!</p>
            </div>
        </div>
    </body>
    </html>
    `);
});

/**
 * Registration Page
 */
app.get('/register', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Register - FunX</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                padding: 20px;
            }
            .container { 
                max-width: 500px; 
                margin: 0 auto; 
                background: rgba(255,255,255,0.1); 
                padding: 40px; 
                border-radius: 20px; 
                backdrop-filter: blur(10px);
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            }
            .logo {
                text-align: center;
                font-size: 3em;
                margin-bottom: 10px;
            }
            .brand-name {
                text-align: center;
                font-size: 2em;
                font-weight: bold;
                margin-bottom: 30px;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .form-group {
                margin-bottom: 20px;
                text-align: left;
            }
            label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
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
                transition: all 0.3s ease;
            }
            .btn:hover {
                background: #ff5252;
            }
            .btn:disabled {
                background: #6c757d;
                cursor: not-allowed;
            }
            .btn-secondary {
                background: #4ecdc4;
            }
            .btn-secondary:hover {
                background: #26a69a;
            }
            .safety-agreement {
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 8px;
                margin: 20px 0;
                max-height: 200px;
                overflow-y: auto;
                font-size: 0.9em;
                text-align: left;
            }
            .checkbox-group {
                display: flex;
                align-items: flex-start;
                margin: 15px 0;
            }
            .checkbox-group input {
                width: auto;
                margin-right: 10px;
                margin-top: 5px;
            }
            .verification-section {
                display: none;
            }
            .error {
                color: #ff6b6b;
                background: rgba(255,255,255,0.1);
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
                display: none;
            }
            .success {
                color: #4ecdc4;
                background: rgba(255,255,255,0.1);
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
                display: none;
            }
            .step-indicator {
                display: flex;
                justify-content: center;
                margin-bottom: 30px;
            }
            .step {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background: rgba(255,255,255,0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 10px;
            }
            .step.active {
                background: #ff6b6b;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">🎮</div>
            <div class="brand-name">FunX</div>
            
            <div class="step-indicator">
                <div class="step active">1</div>
                <div class="step">2</div>
                <div class="step">3</div>
            </div>
            
            <h2 style="text-align: center; margin-bottom: 30px;">Create Your Account</h2>
            
            <div id="errorMessage" class="error"></div>
            <div id="successMessage" class="success"></div>
            
            <div id="emailSection">
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <input type="email" id="email" placeholder="Enter your email" required>
                </div>
                <div class="form-group">
                    <label for="name">Display Name (Optional)</label>
                    <input type="text" id="name" placeholder="What should we call you?">
                </div>
                <button class="btn" onclick="sendVerificationCode()">Send Verification Code</button>
            </div>
            
            <div id="verificationSection" class="verification-section">
                <div class="form-group">
                    <label for="verificationCode">Verification Code</label>
                    <input type="text" id="verificationCode" placeholder="Enter 6-digit code" maxlength="6">
                </div>
                <button class="btn" onclick="verifyCode()">Verify Code</button>
                <button class="btn btn-secondary" onclick="backToEmail()">Back</button>
            </div>
            
            <div id="safetySection" class="verification-section">
                <h3>Safety Agreement</h3>
                <div class="safety-agreement">
                    ${safetyManager.SAFETY_AGREEMENT.split('\n').map(line => `<p>${line}</p>`).join('')}
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="agreeSafety" required>
                    <label for="agreeSafety">I have read and agree to the Safety Agreement</label>
                </div>
                <button class="btn" onclick="completeRegistration()">Complete Registration</button>
                <button class="btn btn-secondary" onclick="backToVerification()">Back</button>
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
                <a href="/" style="color: white; text-decoration: none;">← Back to Home</a>
            </div>
        </div>

        <script>
            let currentEmail = '';
            let currentName = '';

            function showError(message) {
                const errorDiv = document.getElementById('errorMessage');
                errorDiv.textContent = message;
                errorDiv.style.display = 'block';
                document.getElementById('successMessage').style.display = 'none';
            }

            function showSuccess(message) {
                const successDiv = document.getElementById('successMessage');
                successDiv.textContent = message;
                successDiv.style.display = 'block';
                document.getElementById('errorMessage').style.display = 'none';
            }

            function hideMessages() {
                document.getElementById('errorMessage').style.display = 'none';
                document.getElementById('successMessage').style.display = 'none';
            }

            function updateStepIndicator(step) {
                const steps = document.querySelectorAll('.step');
                steps.forEach((s, index) => {
                    s.classList.toggle('active', index < step);
                });
            }

            async function sendVerificationCode() {
                hideMessages();
                
                const email = document.getElementById('email').value;
                const name = document.getElementById('name').value;
                
                if (!email) {
                    showError('Please enter your email address');
                    return;
                }

                // Basic email validation
                const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
                if (!emailRegex.test(email)) {
                    showError('Please enter a valid email address');
                    return;
                }

                currentEmail = email;
                currentName = name;

                try {
                    const response = await fetch('/api/send-verification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email })
                    });

                    const data = await response.json();

                    if (data.success) {
                        showSuccess('Verification code sent to your email!');
                        // Show verification code in console for testing
                        console.log('Verification code:', data.code);
                        
                        // Move to next step
                        document.getElementById('emailSection').style.display = 'none';
                        document.getElementById('verificationSection').style.display = 'block';
                        updateStepIndicator(2);
                    } else {
                        showError(data.error);
                    }
                } catch (error) {
                    showError('Network error. Please try again.');
                }
            }

            async function verifyCode() {
                hideMessages();
                
                const code = document.getElementById('verificationCode').value;
                
                if (!code || code.length !== 6) {
                    showError('Please enter the 6-digit verification code');
                    return;
                }

                try {
                    const response = await fetch('/api/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: currentEmail,
                            name: currentName,
                            verificationCode: code,
                            agreeSafety: false // Will set to true in final step
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        // Move to safety agreement step
                        document.getElementById('verificationSection').style.display = 'none';
                        document.getElementById('safetySection').style.display = 'block';
                        updateStepIndicator(3);
                    } else {
                        showError(data.error);
                    }
                } catch (error) {
                    showError('Network error. Please try again.');
                }
            }

            async function completeRegistration() {
                hideMessages();
                
                const agreeSafety = document.getElementById('agreeSafety').checked;
                
                if (!agreeSafety) {
                    showError('You must agree to the Safety Agreement to continue');
                    return;
                }

                try {
                    const response = await fetch('/api/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: currentEmail,
                            name: currentName,
                            verificationCode: 'verified', // Already verified
                            agreeSafety: true
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        showSuccess('Registration successful! Welcome to FunX!');
                        
                        // Store user data
                        localStorage.setItem('funx_user', JSON.stringify(data.user));
                        localStorage.setItem('funx_token', 'logged_in');
                        
                        // Redirect after delay
                        setTimeout(() => {
                            window.location.href = data.redirect || '/lobby';
                        }, 2000);
                    } else {
                        showError(data.error);
                    }
                } catch (error) {
                    showError('Registration failed. Please try again.');
                }
            }

            function backToEmail() {
                document.getElementById('verificationSection').style.display = 'none';
                document.getElementById('emailSection').style.display = 'block';
                updateStepIndicator(1);
            }

            function backToVerification() {
                document.getElementById('safetySection').style.display = 'none';
                document.getElementById('verificationSection').style.display = 'block';
                updateStepIndicator(2);
            }

            // Enter key support
            document.getElementById('email').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') sendVerificationCode();
            });

            document.getElementById('verificationCode').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') verifyCode();
            });
        </script>
    </body>
    </html>
    `);
});

/**
 * Game Lobby
 */
app.get('/lobby', (req, res) => {
    const availableGames = games.filter(game => !game.comingSoon);
    const comingSoonGames = games.filter(game => game.comingSoon);
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Game Lobby - FunX</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; padding: 20px; }
            .header h1 { font-size: 3em; margin-bottom: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
            .user-info {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                margin-bottom: 30px;
                backdrop-filter: blur(10px);
            }
            .games-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 25px;
                margin: 30px 0;
            }
            .game-card {
                background: rgba(255,255,255,0.1);
                border-radius: 20px;
                padding: 25px;
                text-align: center;
                backdrop-filter: blur(10px);
                border: 2px solid rgba(255,255,255,0.2);
                transition: all 0.3s ease;
            }
            .game-card.available {
                cursor: pointer;
            }
            .game-card.available:hover {
                transform: translateY(-10px);
                background: rgba(255,255,255,0.15);
                border-color: #ff6b6b;
            }
            .game-card.coming-soon {
                opacity: 0.6;
                filter: grayscale(0.3);
            }
            .game-icon { 
                font-size: 3em; 
                margin-bottom: 15px; 
            }
            .game-title { 
                font-size: 1.4em; 
                font-weight: bold; 
                margin-bottom: 8px; 
            }
            .game-version {
                background: rgba(255,255,255,0.2);
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.7em;
                margin-left: 8px;
            }
            .game-description { 
                opacity: 0.8; 
                margin-bottom: 15px; 
                line-height: 1.4;
                font-size: 0.9em;
            }
            .game-meta {
                display: flex;
                justify-content: space-between;
                font-size: 0.8em;
                opacity: 0.7;
                margin-bottom: 15px;
            }
            .game-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                justify-content: center;
                margin-bottom: 15px;
            }
            .game-tag {
                background: rgba(255,255,255,0.2);
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 0.7em;
            }
            .btn {
                padding: 10px 20px;
                background: #ff6b6b;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 1em;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                transition: all 0.3s ease;
            }
            .btn:hover { 
                background: #ff5252; 
                transform: scale(1.05); 
            }
            .btn:disabled {
                background: #6c757d;
                cursor: not-allowed;
                transform: none;
            }
            .btn-back { 
                background: #6c757d; 
            }
            .btn-back:hover { 
                background: #5a6268; 
            }
            .section-title {
                margin: 40px 0 20px 0;
                font-size: 1.5em;
                text-align: center;
            }
            .online-count {
                background: #4ecdc4;
                padding: 5px 10px;
                border-radius: 15px;
                font-size: 0.8em;
                margin-left: 10px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎮 FunX Game Lobby</h1>
                <p>Discover ${games.length} amazing games <span class="online-count">${onlinePlayers.size} Online</span></p>
            </div>

            <div class="user-info">
                <div id="userWelcome">Welcome to FunX Game Lobby!</div>
                <div style="margin-top: 10px;">
                    <button onclick="checkLogin()" class="btn">Check Login Status</button>
                    <button onclick="viewLeaderboard()" class="btn btn-secondary">View Leaderboard</button>
                    <button onclick="refreshGames()" class="btn">Refresh Games</button>
                </div>
            </div>

            ${availableGames.length > 0 ? `
            <div class="section-title">🎯 Available Games</div>
            <div class="games-grid">
                ${availableGames.map(game => `
                <div class="game-card available" onclick="startGame('${game.id}')" style="border-color: ${game.color || '#ff6b6b'}">
                    <div class="game-icon">${game.icon}</div>
                    <div class="game-title">
                        ${game.title}
                        <span class="game-version">${game.version}</span>
                    </div>
                    <div class="game-description">${game.description}</div>
                    <div class="game-meta">
                        <span>${game.difficulty}</span>
                        <span>${game.duration}</span>
                        <span>${game.players}</span>
                    </div>
                    <div class="game-tags">
                        ${game.tags.map(tag => `<span class="game-tag">${tag}</span>`).join('')}
                    </div>
                    <button class="btn" style="background: ${game.color || '#ff6b6b'}">Play Now</button>
                </div>
                `).join('')}
            </div>
            ` : '<div class="section-title">No games available yet. Add some games to the games folder!</div>'}

            ${comingSoonGames.length > 0 ? `
            <div class="section-title">🚧 Coming Soon</div>
            <div class="games-grid">
                ${comingSoonGames.map(game => `
                <div class="game-card coming-soon">
                    <div class="game-icon">${game.icon}</div>
                    <div class="game-title">
                        ${game.title}
                        <span class="game-version">${game.version}</span>
                    </div>
                    <div class="game-description">${game.description}</div>
                    <div class="game-meta">
                        <span>${game.difficulty}</span>
                        <span>${game.duration}</span>
                        <span>${game.players}</span>
                    </div>
                    <button class="btn" disabled>Coming Soon</button>
                </div>
                `).join('')}
            </div>
            ` : ''}

            <div style="text-align: center; margin-top: 40px;">
                <a href="/" class="btn btn-back">🏠 Back to Home</a>
            </div>
        </div>

        <script>
            function checkLogin() {
                const userData = localStorage.getItem('funx_user');
                if (userData) {
                    const user = JSON.parse(userData);
                    document.getElementById('userWelcome').textContent = 
                        'Welcome ' + user.name + '! Level ' + user.level + ' | XP: ' + user.xp;
                } else {
                    document.getElementById('userWelcome').textContent = 
                        'Not logged in. <a href="/register" style="color: #4ecdc4;">Register now</a> to save your progress!';
                }
            }

            function startGame(gameId) {
                const userData = localStorage.getItem('funx_user');
                if (!userData) {
                    if (confirm('You need to register to play games. Register now?')) {
                        window.location.href = '/register';
                        return;
                    }
                }
                window.location.href = '/game/' + gameId;
            }

            function refreshGames() {
                fetch('/api/games')
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            alert('Games list refreshed!');
                            location.reload();
                        }
                    });
            }

            function viewLeaderboard() {
                window.location.href = '/leaderboard';
            }

            // Check login status on page load
            checkLogin();
        </script>
    </body>
    </html>
    `);
});

/**
 * Leaderboard Page
 */
app.get('/leaderboard', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Leaderboard - FunX</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 800px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; padding: 20px; }
            .leaderboard {
                background: rgba(255,255,255,0.1);
                border-radius: 15px;
                padding: 20px;
                backdrop-filter: blur(10px);
            }
            .player-row {
                display: flex;
                justify-content: space-between;
                padding: 15px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                align-items: center;
            }
            .player-row:last-child {
                border-bottom: none;
            }
            .rank {
                font-weight: bold;
                font-size: 1.2em;
                width: 50px;
            }
            .player-info {
                flex: 1;
                text-align: left;
                margin-left: 20px;
            }
            .player-stats {
                text-align: right;
            }
            .top-3 {
                background: rgba(255,255,255,0.15);
                border-radius: 10px;
                margin: 5px 0;
            }
            .btn {
                padding: 10px 20px;
                background: #ff6b6b;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 1em;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                margin: 10px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🏆 FunX Leaderboard</h1>
                <p>Top players by experience points</p>
            </div>

            <div class="leaderboard" id="leaderboard">
                <div class="player-row" style="justify-content: center;">
                    <div>Loading leaderboard...</div>
                </div>
            </div>

            <div style="text-align: center; margin-top: 30px;">
                <a href="/lobby" class="btn">Back to Lobby</a>
                <a href="/" class="btn">Home</a>
            </div>
        </div>

        <script>
            async function loadLeaderboard() {
                try {
                    const response = await fetch('/api/leaderboard');
                    const data = await response.json();
                    
                    if (data.success) {
                        const leaderboardDiv = document.getElementById('leaderboard');
                        leaderboardDiv.innerHTML = '';
                        
                        data.leaderboard.forEach((player, index) => {
                            const row = document.createElement('div');
                            row.className = `player-row ${index < 3 ? 'top-3' : ''}`;
                            row.innerHTML = \`
                                <div class="rank">#\${player.rank}</div>
                                <div class="player-info">
                                    <strong>\${player.name}</strong>
                                    <div style="font-size: 0.8em; opacity: 0.8;">Level \${player.level}</div>
                                </div>
                                <div class="player-stats">
                                    <strong>\${player.xp} XP</strong>
                                    <div style="font-size: 0.8em; opacity: 0.8;">\${player.gamesPlayed} games</div>
                                </div>
                            \`;
                            leaderboardDiv.appendChild(row);
                        });
                    }
                } catch (error) {
                    document.getElementById('leaderboard').innerHTML = 
                        '<div class="player-row">Error loading leaderboard</div>';
                }
            }

            loadLeaderboard();
        </script>
    </body>
    </html>
    `);
});

/**
 * Dynamic Game Routes
 */
games.forEach(game => {
    app.get(`/game/${game.id}`, (req, res) => {
        const gameFile = gameManager.getGameFilePath(game.id);
        
        if (gameFile && fs.existsSync(gameFile)) {
            const htmlContent = fs.readFileSync(gameFile, 'utf8');
            
            // Add navigation to game pages
            const modifiedHtml = htmlContent.replace(
                '</body>',
                `
                <div style="text-align: center; margin: 20px; padding: 20px;">
                    <a href="/lobby" style="display: inline-block; padding: 10px 20px; background: #6c757d; color: white; text-decoration: none; border-radius: 8px; margin: 5px;">← Back to Lobby</a>
                    <a href="/" style="display: inline-block; padding: 10px 20px; background: #6c757d; color: white; text-decoration: none; border-radius: 8px; margin: 5px;">🏠 Home</a>
                </div>
                </body>`
            );
            
            res.send(modifiedHtml);
        } else {
            res.status(404).send(`
                <html>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h2>❌ Game Not Found</h2>
                        <p>Game file for ${game.id} does not exist</p>
                        <a href="/lobby">Back to Lobby</a>
                    </body>
                </html>
            `);
        }
    });
});

// ==================== Socket.IO Multiplayer System ====================

io.on('connection', (socket) => {
    console.log('🔗 Player connected:', socket.id);

    // Player joins the platform
    socket.on('player_join', (playerData) => {
        const { userId, name, email } = playerData;
        
        onlinePlayers.set(socket.id, {
            socketId: socket.id,
            userId: userId,
            name: name,
            email: email,
            joinedAt: new Date().toISOString(),
            currentGame: null
        });

        console.log(`👤 Player joined: ${name} (${socket.id})`);
        
        // Update online players count for all clients
        io.emit('online_players_update', {
            count: onlinePlayers.size,
            players: Array.from(onlinePlayers.values()).map(p => ({
                name: p.name,
                currentGame: p.currentGame
            }))
        });

        socket.emit('join_success', {
            message: 'Connected to FunX platform',
            playerId: socket.id,
            onlinePlayers: onlinePlayers.size
        });
    });

    // Player starts a game
    socket.on('game_start', (gameData) => {
        const player = onlinePlayers.get(socket.id);
        if (player) {
            player.currentGame = gameData.gameId;
            console.log(`🎮 ${player.name} started game: ${gameData.gameId}`);
            
            // Notify others in the same game
            socket.broadcast.emit('player_game_update', {
                playerName: player.name,
                gameId: gameData.gameId,
                action: 'started'
            });
        }
    });

    // Player scores points
    socket.on('game_score', (scoreData) => {
        const player = onlinePlayers.get(socket.id);
        if (player && player.userId) {
            console.log(`🏆 ${player.name} scored: ${scoreData.points} in ${scoreData.gameId}`);
            
            // Update user XP and coins
            const updatedUser = authManager.updateUser(player.userId, {
                xp: (authManager.findUserByEmail(player.email)?.xp || 0) + scoreData.points,
                coins: (authManager.findUserByEmail(player.email)?.coins || 0) + Math.floor(scoreData.points / 10),
                gamesPlayed: (authManager.findUserByEmail(player.email)?.gamesPlayed || 0) + 1,
                lastLogin: new Date().toISOString()
            });
            
            // Broadcast high scores
            if (scoreData.points > 100) { // Only broadcast significant scores
                socket.broadcast.emit('player_achievement', {
                    playerName: player.name,
                    achievement: `scored ${scoreData.points} points`,
                    game: scoreData.gameId
                });
            }
        }
    });

    // Real-time chat
    socket.on('chat_message', (messageData) => {
        const player = onlinePlayers.get(socket.id);
        if (player) {
            io.emit('chat_message', {
                player: player.name,
                message: messageData.message,
                timestamp: new Date().toISOString()
            });
        }
    });

    // Ping system for connection health
    socket.on('ping', () => {
        socket.emit('pong', { 
            time: new Date().toISOString(),
            serverTime: Date.now()
        });
    });

    socket.on('disconnect', () => {
        const player = onlinePlayers.get(socket.id);
        if (player) {
            console.log(`❌ Player disconnected: ${player.name} (${socket.id})`);
            onlinePlayers.delete(socket.id);
            
            // Update online players count
            io.emit('online_players_update', {
                count: onlinePlayers.size,
                players: Array.from(onlinePlayers.values()).map(p => ({
                    name: p.name,
                    currentGame: p.currentGame
                }))
            });
        }
    });
});

// ==================== Initialize Server ====================

// Initialize games
games = gameManager.loadGamesManifest();

// Ensure data directory exists
emailService.ensureDataDir();

// Start server
server.listen(PORT, () => {
    console.log('=================================');
    console.log('🎮 FunX Game Platform Started!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🎯 Games: ${games.length}`);
    console.log(`🌐 Home: http://localhost:${PORT}/`);
    console.log(`📝 Register: http://localhost:${PORT}/register`);
    console.log(`🏠 Lobby: http://localhost:${PORT}/lobby`);
    console.log('=================================');
    
    // Display available games
    games.forEach((game, index) => {
        console.log(`   ${index + 1}. ${game.title} - /game/${game.id}`);
    });
});

// ==================== Error Handling ====================
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});