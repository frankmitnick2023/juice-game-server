// server.js - FunX Game Platform (Fixed Version)
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
 * Utility Functions
 */
const utils = {
    ensureDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    },
    
    safeJSONParse(filePath, defaultValue = {}) {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.error('Error parsing JSON file:', filePath, error);
        }
        return defaultValue;
    },
    
    safeJSONWrite(filePath, data) {
        try {
            this.ensureDirectory(path.dirname(filePath));
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Error writing JSON file:', filePath, error);
            return false;
        }
    }
};

/**
 * Game Manager
 */
const gameManager = {
    loadGamesManifest() {
        try {
            if (fs.existsSync(MANIFEST_FILE)) {
                const manifest = utils.safeJSONParse(MANIFEST_FILE);
                console.log(`🎮 Loaded ${manifest.games?.length || 0} games`);
                return manifest.games || [];
            }
        } catch (error) {
            console.error('❌ Failed to load game manifest:', error);
        }
        
        return this.scanGamesDirectory();
    },

    scanGamesDirectory() {
        const games = [];
        
        try {
            utils.ensureDirectory(GAMES_DIR);
            
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
        console.log('🔄 Games reloaded:', games.length);
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
        utils.ensureDirectory(DATA_DIR);
        
        let verifications = utils.safeJSONParse(verifyFile, {});
        verifications[email] = verificationData;
        
        utils.safeJSONWrite(verifyFile, verifications);
        
        // In production, integrate with email service like SendGrid
        console.log(`📧 Verification code for ${email}: ${code}`);
        
        return { 
            success: true, 
            message: 'Verification code sent to your email',
            code: code // Remove this in production
        };
    },
    
    // Verify code
    async verifyCode(email, code) {
        const verifyFile = path.join(DATA_DIR, 'verifications.json');
        const verifications = utils.safeJSONParse(verifyFile, {});
        const data = verifications[email];
        
        if (!data) {
            return { success: false, error: 'No verification request for this email' };
        }
        
        if (Date.now() > data.expiresAt) {
            delete verifications[email];
            utils.safeJSONWrite(verifyFile, verifications);
            return { success: false, error: 'Verification code expired' };
        }
        
        if (data.attempts >= 5) {
            return { success: false, error: 'Too many attempts. Please request a new code.' };
        }
        
        data.attempts += 1;
        utils.safeJSONWrite(verifyFile, verifications);
        
        if (data.code === code) {
            // Verification successful, remove the code
            delete verifications[email];
            utils.safeJSONWrite(verifyFile, verifications);
            return { success: true, message: 'Email verified successfully' };
        } else {
            return { success: false, error: 'Invalid verification code' };
        }
    }
};

/**
 * User Authentication & Safety System
 */
const authManager = {
    USER_DB: path.join(DATA_DIR, 'users.json'),
    
    // User registration with email verification
    async registerUser(userData) {
        utils.ensureDirectory(DATA_DIR);
        const db = utils.safeJSONParse(this.USER_DB, { users: [] });
        
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
            verified: true,
            level: 1,
            xp: 0,
            coins: 100,
            safetyAgreed: userData.agreeSafety,
            safetyAgreedAt: new Date().toISOString(),
            registeredAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            gamesPlayed: 0,
            totalScore: 0
        };
        
        db.users.push(newUser);
        utils.safeJSONWrite(this.USER_DB, db);
        
        console.log('👤 New user registered:', newUser.email);
        return { success: true, user: newUser };
    },
    
    // Find user by email
    findUserByEmail(email) {
        const db = utils.safeJSONParse(this.USER_DB, { users: [] });
        return db.users.find(u => u.email === email);
    },
    
    // Update user data
    updateUser(userId, updates) {
        const db = utils.safeJSONParse(this.USER_DB, { users: [] });
        const userIndex = db.users.findIndex(u => u.id === userId);
        
        if (userIndex !== -1) {
            db.users[userIndex] = { ...db.users[userIndex], ...updates };
            utils.safeJSONWrite(this.USER_DB, db);
            return db.users[userIndex];
        }
        return null;
    },
    
    // Get all users (for leaderboard)
    getAllUsers() {
        const db = utils.safeJSONParse(this.USER_DB, { users: [] });
        return db.users.sort((a, b) => b.xp - a.xp);
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
        utils.ensureDirectory(DATA_DIR);
        
        let agreements = utils.safeJSONParse(agreementFile, []);
        agreements.push({
            userId: userId,
            email: email,
            agreedAt: new Date().toISOString(),
            userAgent: userAgent || 'unknown'
        });
        
        utils.safeJSONWrite(agreementFile, agreements);
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
        console.error('Send verification error:', error);
        res.json({ success: false, error: 'Failed to send verification code' });
    }
});

/**
 * Complete Registration
 */
app.post('/api/register', async (req, res) => {
    const { email, name, verificationCode, agreeSafety } = req.body;
    
    // Validate required fields
    if (!email || !verificationCode) {
        return res.json({ 
            success: false, 
            error: 'Email and verification code are required' 
        });
    }
    
    try {
        // Verify email code (skip if it's 'verified' from previous step)
        if (verificationCode !== 'verified') {
            const verifyResult = await emailService.verifyCode(email, verificationCode);
            if (!verifyResult.success) {
                return res.json(verifyResult);
            }
        }
        
        // Record safety agreement
        const tempUserId = 'temp_' + Date.now();
        safetyManager.recordAgreement(tempUserId, email, req.get('User-Agent'));
        
        // Create user account
        const registrationResult = await authManager.registerUser({
            email,
            name,
            agreeSafety: !!agreeSafety
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
        console.error('Registration error:', error);
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
    try {
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
    } catch (error) {
        res.json({
            success: false,
            error: 'Failed to load leaderboard',
            leaderboard: []
        });
    }
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
        </div>
    </body>
    </html>
    `);
});

/**
 * Registration Page
 */
app.get('/register', (req, res) => {
    const safeAgreement = safetyManager.SAFETY_AGREEMENT.replace(/\n/g, '<br>');
    
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
            }
            .btn:disabled {
                background: #6c757d;
                cursor: not-allowed;
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
            .verification-section {
                display: none;
            }
            .error {
                color: #ff6b6b;
                background: rgba(255,255,255,0.1);
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
            }
            .success {
                color: #4ecdc4;
                background: rgba(255,255,255,0.1);
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="font-size: 3em;">🎮</div>
                <h1>FunX Registration</h1>
            </div>
            
            <div id="errorMessage" class="error" style="display: none;"></div>
            <div id="successMessage" class="success" style="display: none;"></div>
            
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
                <button class="btn" onclick="backToEmail()" style="background: #6c757d;">Back</button>
            </div>
            
            <div id="safetySection" class="verification-section">
                <h3>Safety Agreement</h3>
                <div class="safety-agreement">
                    ${safeAgreement}
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="agreeSafety" required>
                        I agree to the Safety Agreement
                    </label>
                </div>
                <button class="btn" onclick="completeRegistration()">Complete Registration</button>
                <button class="btn" onclick="backToVerification()" style="background: #6c757d;">Back</button>
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
                <a href="/" style="color: white;">← Back to Home</a>
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

            async function sendVerificationCode() {
                hideMessages();
                
                const email = document.getElementById('email').value;
                const name = document.getElementById('name').value;
                
                if (!email) {
                    showError('Please enter your email address');
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
                        showSuccess('Verification code sent! Check console for code.');
                        console.log('Verification code:', data.code);
                        
                        document.getElementById('emailSection').style.display = 'none';
                        document.getElementById('verificationSection').style.display = 'block';
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
                
                if (!code) {
                    showError('Please enter the verification code');
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
                            agreeSafety: false
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        document.getElementById('verificationSection').style.display = 'none';
                        document.getElementById('safetySection').style.display = 'block';
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
                    showError('You must agree to the Safety Agreement');
                    return;
                }

                try {
                    const response = await fetch('/api/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: currentEmail,
                            name: currentName,
                            verificationCode: 'verified',
                            agreeSafety: true
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        showSuccess('Registration successful! Redirecting...');
                        localStorage.setItem('funx_user', JSON.stringify(data.user));
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
            }

            function backToVerification() {
                document.getElementById('safetySection').style.display = 'none';
                document.getElementById('verificationSection').style.display = 'block';
            }

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
 * Game Lobby (Simplified)
 */
app.get('/lobby', (req, res) => {
    const availableGames = games.filter(game => !game.comingSoon);
    
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Game Lobby - FunX</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                margin: 0;
                padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 40px; }
            .games-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
            }
            .game-card {
                background: rgba(255,255,255,0.1);
                padding: 20px;
                border-radius: 15px;
                text-align: center;
                cursor: pointer;
            }
            .game-card:hover {
                background: rgba(255,255,255,0.2);
            }
            .btn {
                padding: 10px 20px;
                background: #ff6b6b;
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                margin: 5px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎮 FunX Game Lobby</h1>
                <p>${games.length} games available • ${onlinePlayers.size} players online</p>
            </div>

            <div style="text-align: center; margin: 20px 0;">
                <a href="/" class="btn">Home</a>
                <a href="/register" class="btn">Register</a>
            </div>

            <div class="games-grid">
                ${availableGames.map(game => `
                <div class="game-card" onclick="startGame('${game.id}')">
                    <div style="font-size: 3em;">${game.icon}</div>
                    <h3>${game.title}</h3>
                    <p>${game.description}</p>
                    <button class="btn">Play</button>
                </div>
                `).join('')}
            </div>

            ${availableGames.length === 0 ? `
            <div style="text-align: center; padding: 40px;">
                <h3>No games available yet</h3>
                <p>Add HTML game files to the games folder</p>
            </div>
            ` : ''}
        </div>

        <script>
            function startGame(gameId) {
                window.location.href = '/game/' + gameId;
            }
        </script>
    </body>
    </html>
    `);
});

// ==================== Dynamic Game Routes ====================
app.get('/game/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    const gameFile = gameManager.getGameFilePath(gameId);
    
    if (gameFile && fs.existsSync(gameFile)) {
        try {
            const htmlContent = fs.readFileSync(gameFile, 'utf8');
            const modifiedHtml = htmlContent.replace(
                '</body>',
                `<div style="text-align: center; margin: 20px;">
                    <a href="/lobby" style="color: white; background: #6c757d; padding: 10px 20px; border-radius: 8px; text-decoration: none;">← Back to Lobby</a>
                 </div>
                 </body>`
            );
            res.send(modifiedHtml);
        } catch (error) {
            res.status(500).send('Error loading game');
        }
    } else {
        res.status(404).send('Game not found');
    }
});

// ==================== Socket.IO ====================
io.on('connection', (socket) => {
    console.log('🔗 Player connected:', socket.id);

    socket.on('player_join', (playerData) => {
        onlinePlayers.set(socket.id, {
            socketId: socket.id,
            name: playerData.name || 'Player',
            joinedAt: new Date().toISOString()
        });

        io.emit('online_players_update', { count: onlinePlayers.size });
    });

    socket.on('disconnect', () => {
        onlinePlayers.delete(socket.id);
        io.emit('online_players_update', { count: onlinePlayers.size });
    });
});

// ==================== Initialize Server ====================

// Initialize games
games = gameManager.loadGamesManifest();

// Start server
server.listen(PORT, () => {
    console.log('=================================');
    console.log('🎮 FunX Game Platform Started!');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🎯 Games: ${games.length}`);
    console.log(`🌐 Home: http://localhost:${PORT}/`);
    console.log('=================================');
});

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});