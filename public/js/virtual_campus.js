// virtual_campus.js - 终极融合版 (Phaser引擎 + 墙壁检测 + 联机)

// ================= 全局变量 =================
let gameInstance; 
let player; 
let socket; 
let otherPlayers = {}; 
window.isMapMode = false;

// 用于墙壁检测的画布上下文
let collisionCtx = null; 

// ================= 核心入口函数 =================
window.initVirtualCampus = function() {
    console.log("🚀 启动虚拟校园 (Phaser 引擎版)...");

    // 1. 获取用户信息
    const heroImg = document.getElementById('heroImg');
    const avatarUrl = heroImg ? heroImg.src : '/avatars/boy_junior_uniform.png'; 
    const userName = document.getElementById('userInfo') ? document.getElementById('userInfo').textContent : 'Hero';

    // 2. 内部函数：预加载资源
    function preload() {
        console.log("正在加载资源...");
        // ★★★ 核心：加载您刚才更新的带黑色边界的地图 ★★★
        this.load.image('map_bg', '/images/studio_map.jpg'); 
        this.load.image('student', avatarUrl);
    }

    // 3. 内部函数：创建游戏世界
    function create() {
        // 地图尺寸
        const mapW = 2400;
        const mapH = 1800;

        // A. 创建显示用的地图
        try { 
            let bg = this.add.image(0, 0, 'map_bg').setOrigin(0, 0);
            bg.setDisplaySize(mapW, mapH); 
            
            // ★★★ 移植功能：初始化墙壁数据 (对应旧文件的 initCollisionMap) ★★★
            // 我们在内存里创建一个看不见的 Canvas，专门用来读取墙壁颜色
            const srcImage = this.textures.get('map_bg').getSourceImage();
            const hiddenCanvas = document.createElement('canvas');
            hiddenCanvas.width = mapW;
            hiddenCanvas.height = mapH;
            collisionCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
            collisionCtx.drawImage(srcImage, 0, 0, mapW, mapH);
            console.log("✅ 墙壁碰撞数据已生成");
            
        } catch(e) { console.log("地图加载错误:", e); }

        // B. 设置物理边界
        this.physics.world.setBounds(0, 0, mapW, mapH);

        // C. 创建玩家 (初始位置避开墙壁)
        player = this.physics.add.sprite(2000, 300, 'student'); 
        player.setDisplaySize(60, 80); 
        player.setCollideWorldBounds(true); 

        // D. 摄像机跟随
        this.cameras.main.setBounds(0, 0, mapW, mapH);
        this.cameras.main.startFollow(player);

        // E. ★★★ 移植功能：鼠标点击移动 + 墙壁检测 ★★★
        this.input.on('pointerdown', (pointer) => {
            // 只有点击顶部菜单(y>50)以下才移动
            if (pointer.y > 50) {
                const startX = player.x;
                const startY = player.y;
                const targetX = pointer.worldX;
                const targetY = pointer.worldY;

                // 1. 检查终点是不是墙
                if (isWall(targetX, targetY)) {
                    showGameTip("🚫 撞墙了 (此处不可移动)");
                    return;
                }

                // 2. 检查路径上有没有墙 (防穿墙)
                if (checkPathBlocked(startX, startY, targetX, targetY)) {
                    showGameTip("🚫 前方有墙挡路");
                    return;
                }

                // 3. 移动逻辑
                this.physics.moveTo(player, targetX, targetY, 300);
                
                player.targetX = targetX;
                player.targetY = targetY;
                player.isMoving = true;

                // 转向
                if (targetX < player.x) player.flipX = true;
                else player.flipX = false;

                // 联机同步
                if(socket) socket.emit('playerMovement', { x: targetX, y: targetY });
            }
        }, this);

        // F. 启动联机
        initSocketConnection(userName, avatarUrl, this);
    }

    // 4. 内部函数：每帧更新
    function update() {
        if (player && player.isMoving) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, player.targetX, player.targetY);
            if (dist < 10) {
                player.body.reset(player.targetX, player.targetY);
                player.isMoving = false;
            }
        }
    }

    // ★★★ 移植功能：判断是否是墙 (对应旧文件的 isWall) ★★★
    function isWall(x, y) {
        if (!collisionCtx) return false;
        try {
            // 读取像素颜色
            const p = collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
            // RGB 值越低越黑。如果 RGB 加起来小于 100，认为是黑色墙壁
            const brightness = p[0] + p[1] + p[2];
            if (brightness < 100) return true; // 是墙
            return false;
        } catch(e) { return false; }
    }

    // ★★★ 移植功能：路径检查 (对应旧文件的 checkPathBlocked) ★★★
    function checkPathBlocked(x1, y1, x2, y2) {
        const steps = 15; // 检测密度
        const dx = (x2 - x1) / steps;
        const dy = (y2 - y1) / steps;

        for (let i = 1; i < steps; i++) {
            const checkX = x1 + dx * i;
            const checkY = y1 + dy * i;
            if (isWall(checkX, checkY)) return true; // 只要有一点碰到墙，就阻挡
        }
        return false;
    }

    // 显示屏幕提示
    function showGameTip(text) {
        const tip = document.createElement('div');
        tip.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.8); color:#e94560; padding:10px 20px; border-radius:10px; font-weight:bold; z-index:1000; pointer-events:none; border:2px solid #e94560;";
        tip.textContent = text;
        document.body.appendChild(tip);
        setTimeout(() => tip.remove(), 1500);
    }

    // 5. 游戏配置
    const config = {
        type: Phaser.AUTO,
        parent: 'phaser-game', 
        width: window.innerWidth,
        height: window.innerHeight,
        canvasContext: { willReadFrequently: true },
        physics: { default: 'arcade', arcade: { debug: false } },
        scene: { preload: preload, create: create, update: update }
    };

    // 销毁旧实例
    if(gameInstance) gameInstance.destroy(true);
    gameInstance = new Phaser.Game(config);
};

// ================= 联机逻辑 (保持完整) =================
function initSocketConnection(name, avatar, scene) {
    if (typeof io === 'undefined') return;
    if(socket && socket.connected) socket.disconnect();
    
    socket = io(); 

    socket.on('connect', () => {
        console.log("✅ 联机成功");
        const led = document.getElementById('net-status');
        if(led) led.classList.add('online');
        // 加入游戏，位置避开墙壁
        socket.emit('joinGame', { x: 2000, y: 300, name: name, avatar: avatar });
    });

    socket.on('newPlayer', (p) => addOtherPlayer(scene, p));
    socket.on('currentPlayers', (ps) => {
        Object.keys(ps).forEach(id => {
            if (id !== socket.id) addOtherPlayer(scene, ps[id]);
        });
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
        if (otherPlayers[id]) {
            otherPlayers[id].destroy();
            delete otherPlayers[id];
        }
    });
}

function addOtherPlayer(scene, pInfo) {
    if (otherPlayers[pInfo.id]) return;
    const other = scene.physics.add.sprite(pInfo.x, pInfo.y, 'student'); 
    other.setDisplaySize(60, 80);
    other.setTint(0xcccccc); 
    otherPlayers[pInfo.id] = other;
}

// ================= 按钮功能 (保持完整) =================
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
    if (window.isMapMode) {
        if(btn) { btn.textContent = "🔍 Close Map"; btn.style.background = "#e94560"; }
        if (gameInstance) gameInstance.scene.scenes[0].cameras.main.zoomTo(0.3, 1000);
    } else {
        if(btn) { btn.textContent = "🗺️ Map View"; btn.style.background = "rgba(0,0,0, 0.7)"; }
        if (gameInstance) gameInstance.scene.scenes[0].cameras.main.zoomTo(1, 1000);
    }
};

window.movePlayerTo = function(x, y) { if(player) { player.x = x; player.y = y; } };