// virtual_campus.js - 修复文件名 + 防崩溃版

// ================= 全局变量 =================
let gameInstance; 
let player; 
let socket; 
let otherPlayers = {}; 
window.isMapMode = false;
let collisionCtx = null; 

// ================= 核心入口函数 =================
window.initVirtualCampus = function() {
    console.log("🚀 启动虚拟校园 (PNG修复版)...");

    // 1. 获取用户信息
    const heroImg = document.getElementById('heroImg');
    const avatarUrl = heroImg ? heroImg.src : '/avatars/boy_junior_uniform.png'; 
    const userName = document.getElementById('userInfo') ? document.getElementById('userInfo').textContent : 'Hero';

    // 2. 内部函数：预加载
    function preload() {
        console.log("正在加载资源...");
        // ★★★ 修复 1：修改为正确的 .png 后缀 ★★★
        this.load.image('map_bg', '/images/studio_map.png'); 
        this.load.image('student', avatarUrl);
    }

    // 3. 内部函数：创建世界
    function create() {
        const mapW = 2400;
        const mapH = 1800;

        // A. 创建显示用的地图
        try { 
            let bg = this.add.image(0, 0, 'map_bg').setOrigin(0, 0);
            bg.setDisplaySize(mapW, mapH); 
            bg.setDepth(0); // 地图在最底层

            // ★★★ 初始化墙壁数据 ★★★
            const srcImage = this.textures.get('map_bg').getSourceImage();
            const hiddenCanvas = document.createElement('canvas');
            hiddenCanvas.width = mapW;
            hiddenCanvas.height = mapH;
            collisionCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
            collisionCtx.drawImage(srcImage, 0, 0, mapW, mapH);
            console.log("✅ 墙壁数据生成成功");
            
        } catch(e) { 
            console.error("❌ 地图加载或解析失败 (但不影响人物):", e); 
        }

        // B. 设置物理边界
        this.physics.world.setBounds(0, 0, mapW, mapH);

        // C. 创建玩家
        // ★★★ 修复 2：位置设为 1250, 1200 (中心区域)，并设置层级 ★★★
        player = this.physics.add.sprite(1250, 1200, 'student'); 
        player.setDisplaySize(60, 80); 
        player.setCollideWorldBounds(true); 
        player.setDepth(10); // ★★★ 确保人物永远在地图上层 ★★★

        // D. 摄像机跟随
        this.cameras.main.setBounds(0, 0, mapW, mapH);
        this.cameras.main.startFollow(player);

        // E. 鼠标点击移动 + 墙壁检测
        this.input.on('pointerdown', (pointer) => {
            if (pointer.y > 50) { // 避开顶部按钮区
                const targetX = pointer.worldX;
                const targetY = pointer.worldY;

                // 1. 墙壁检测 (如果地图加载失败，isWall 默认返回 false，保证能动)
                if (isWall(targetX, targetY)) {
                    showGameTip("🚫 撞墙了");
                    return;
                }
                if (checkPathBlocked(player.x, player.y, targetX, targetY)) {
                    showGameTip("🚫 有墙挡路");
                    return;
                }

                // 2. 移动
                this.physics.moveTo(player, targetX, targetY, 300);
                player.targetX = targetX;
                player.targetY = targetY;
                player.isMoving = true;

                // 转向
                if (targetX < player.x) player.flipX = true;
                else player.flipX = false;

                // 联机
                if(socket) socket.emit('playerMovement', { x: targetX, y: targetY });
            }
        }, this);

        // F. 启动联机
        initSocketConnection(userName, avatarUrl, this);
    }

    // 4. 更新循环
    function update() {
        if (player && player.isMoving) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, player.targetX, player.targetY);
            if (dist < 10) {
                player.body.reset(player.targetX, player.targetY);
                player.isMoving = false;
            }
        }
    }

    // 辅助：墙壁检测
    function isWall(x, y) {
        if (!collisionCtx) return false; // 如果地图没加载好，允许穿墙，不卡死
        try {
            const p = collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
            // 黑色墙壁 (RGB总和 < 100)
            if ((p[0] + p[1] + p[2]) < 100) return true;
            return false;
        } catch(e) { return false; }
    }

    // 辅助：路径检查
    function checkPathBlocked(x1, y1, x2, y2) {
        const steps = 15;
        const dx = (x2 - x1) / steps;
        const dy = (y2 - y1) / steps;
        for (let i = 1; i < steps; i++) {
            if (isWall(x1 + dx * i, y1 + dy * i)) return true;
        }
        return false;
    }

    // 辅助：屏幕提示
    function showGameTip(text) {
        const tip = document.createElement('div');
        tip.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.8); color:#e94560; padding:10px 20px; border-radius:10px; font-weight:bold; z-index:1000; pointer-events:none; border:2px solid #e94560;";
        tip.textContent = text;
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 1500);
    }

    // 游戏配置
    const config = {
        type: Phaser.AUTO,
        parent: 'phaser-game', 
        width: window.innerWidth,
        height: window.innerHeight,
        canvasContext: { willReadFrequently: true },
        physics: { default: 'arcade', arcade: { debug: false } },
        scene: { preload: preload, create: create, update: update }
    };

    if(gameInstance) gameInstance.destroy(true);
    gameInstance = new Phaser.Game(config);
};

// ================= 联机逻辑 =================
function initSocketConnection(name, avatar, scene) {
    if (typeof io === 'undefined') return;
    if(socket && socket.connected) socket.disconnect();
    socket = io(); 

    socket.on('connect', () => {
        const led = document.getElementById('net-status');
        if(led) led.classList.add('online');
        socket.emit('joinGame', { x: 1250, y: 1200, name: name, avatar: avatar });
    });

    socket.on('newPlayer', (p) => addOtherPlayer(scene, p));
    socket.on('currentPlayers', (ps) => {
        Object.keys(ps).forEach(id => { if (id !== socket.id) addOtherPlayer(scene, ps[id]); });
    });

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            scene.physics.moveTo(otherPlayers[data.id], data.x, data.y, 300);
            scene.tweens.add({
                targets: otherPlayers[data.id],
                x: data.x, y: data.y, duration: 200,
                onUpdate: () => {
                    if(data.x < otherPlayers[data.id].x) otherPlayers[data.id].flipX = true;
                    else otherPlayers[data.id].flipX = false;
                }
            });
        }
    });

    socket.on('disconnect', (id) => {
        if (otherPlayers[id]) { otherPlayers[id].destroy(); delete otherPlayers[id]; }
    });
}

function addOtherPlayer(scene, pInfo) {
    if (otherPlayers[pInfo.id]) return;
    const other = scene.physics.add.sprite(pInfo.x, pInfo.y, 'student'); 
    other.setDisplaySize(60, 80);
    other.setTint(0xcccccc);
    other.setDepth(10); // ★ 确保其他人也在地图上面
    otherPlayers[pInfo.id] = other;
}

// ================= 按钮功能 =================
window.exitVirtualWorld = function() {
    document.getElementById('virtualWorld').style.display = 'none';
    const lobby = document.getElementById('lobbyView');
    if(lobby) lobby.style.display = 'block';
    const nav = document.querySelector('.nav-bar');
    if(nav) nav.style.display = 'flex';
    if(socket) socket.disconnect();
    if(gameInstance) { gameInstance.destroy(true); gameInstance = null; }
};

window.toggleMapMode = function() {
    window.isMapMode = !window.isMapMode;
    const btn = document.getElementById('btn-map-mode');
    
    // 增加判空保护，防止游戏没启动时点击报错
    if (!gameInstance || !gameInstance.scene || !gameInstance.scene.scenes[0]) return;

    const cam = gameInstance.scene.scenes[0].cameras.main;

    if (window.isMapMode) {
        if(btn) { btn.textContent = "🔍 Close Map"; btn.style.background = "#e94560"; }
        cam.zoomTo(0.3, 1000);
    } else {
        if(btn) { btn.textContent = "🗺️ Map View"; btn.style.background = "rgba(0,0,0, 0.7)"; }
        cam.zoomTo(1, 1000);
    }
};

window.movePlayerTo = function(x, y) { if(player) { player.x = x; player.y = y; } };