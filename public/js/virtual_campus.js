// virtual_campus.js - 全功能修复整合版

// ================= 全局变量 =================
let gameInstance; // 游戏实例
let player;       // 玩家角色
let socket;       // 联机插座
let otherPlayers = {}; // 其他玩家列表
window.isMapMode = false; // 地图模式状态

// ================= 核心入口函数 =================
window.initVirtualCampus = function() {
    console.log("🚀 启动虚拟校园 (Phaser 引擎版)...");

    // 1. 获取当前用户信息 (从 HTML 页面读取)
    const heroImg = document.getElementById('heroImg');
    const avatarUrl = heroImg ? heroImg.src : '/avatars/boy_junior_uniform.png'; 
    const userName = document.getElementById('userInfo') ? document.getElementById('userInfo').textContent : 'Hero';

    // 2. Phaser 游戏配置
    const config = {
        type: Phaser.AUTO,
        parent: 'phaser-game', // 对应 HTML 里的 div id
        width: window.innerWidth,
        height: window.innerHeight,
        
        // ★ 性能优化：消除黄色警告
        canvasContext: { willReadFrequently: true },
        
        physics: {
            default: 'arcade',
            arcade: {
                debug: false // 设为 true 可看到碰撞边界调试
            }
        },
        scene: {
            preload: preload,
            create: create,
            update: update
        }
    };

    // --- 内部函数：预加载资源 ---
    function preload() {
        // ★ 背景地图：如果没有这张图，背景可能是黑的，但功能正常
        // 您可以换成您的地图路径，例如 '/images/background.png'
        this.load.image('map_bg', '/images/studio_map.png'); 
        
        // 加载玩家头像
        this.load.image('student', avatarUrl);
    }

    // --- 内部函数：创建世界 (核心逻辑) ---
    function create() {
        // A. 创建地图背景
        // 假设地图尺寸是 2400 x 1800，请根据实际图片调整
        try { 
            let bg = this.add.image(0, 0, 'map_bg').setOrigin(0, 0);
            bg.setDisplaySize(2400, 1800); // 强制拉伸到指定大小
        } catch(e) { console.log("地图背景加载失败，使用默认黑底"); }

        // B. ★★★ 设置世界边界 (防止走出地图) ★★★
        this.physics.world.setBounds(0, 0, 2400, 1800);

        // C. 创建玩家
        // 初始位置 1250, 1200
        player = this.physics.add.sprite(1250, 1200, 'student');
        player.setDisplaySize(60, 80); // 调整人物显示大小
        player.setCollideWorldBounds(true); // ★ 开启撞墙限制，禁止出界

        // D. 摄像机跟随
        this.cameras.main.setBounds(0, 0, 2400, 1800);
        this.cameras.main.startFollow(player);

        // E. ★★★ 鼠标点击移动 (修复人物不动的关键) ★★★
        this.input.on('pointerdown', (pointer) => {
            // 简单防误触：只有点击顶部菜单(y>50)以下才移动
            if (pointer.y > 50) {
                // 物理移动：让人物走到点击的坐标
                this.physics.moveTo(player, pointer.worldX, pointer.worldY, 300); // 300 是速度
                
                // 记录目标点，用于在 update 里判断是否到达
                player.targetX = pointer.worldX;
                player.targetY = pointer.worldY;
                player.isMoving = true;

                // 翻转图片朝向
                if (pointer.worldX < player.x) player.flipX = true;
                else player.flipX = false;

                // 联机：告诉服务器我动了
                if(socket) socket.emit('playerMovement', { x: pointer.worldX, y: pointer.worldY });
            }
        }, this);

        // F. 启动联机 (传入当前场景 this)
        initSocketConnection(userName, avatarUrl, this);
    }

    // --- 内部函数：每帧更新 ---
    function update() {
        // 如果正在移动，检查是否到达目标
        if (player && player.isMoving) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, player.targetX, player.targetY);
            // 如果距离小于 10 像素，认为到达，停止移动
            if (dist < 10) {
                player.body.reset(player.targetX, player.targetY); // 强制停住
                player.isMoving = false;
            }
        }
    }

    // 销毁旧游戏防止重复
    if(gameInstance) gameInstance.destroy(true);
    gameInstance = new Phaser.Game(config);
};

// ================= 联机逻辑 (适配 Phaser) =================
function initSocketConnection(name, avatar, scene) {
    if (typeof io === 'undefined') {
        console.error("Socket.io 未加载");
        return;
    }
    
    // 避免重复连接
    if(socket && socket.connected) socket.disconnect();
    
    socket = io(); 

    // 1. 连接成功
    socket.on('connect', () => {
        console.log("✅ 联机成功! ID:", socket.id);
        const led = document.getElementById('net-status');
        if(led) led.classList.add('online');

        // 发送加入请求
        socket.emit('joinGame', {
            x: 1250, 
            y: 1200,
            name: name,
            avatar: avatar
        });
    });

    // 2. 别人加入
    socket.on('newPlayer', (pInfo) => {
        addOtherPlayer(scene, pInfo);
    });

    // 3. 显示已在场的玩家
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) addOtherPlayer(scene, players[id]);
        });
    });

    // 4. 别人移动
    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            const other = otherPlayers[data.id];
            // 使用物理引擎移动别人
            scene.physics.moveTo(other, data.x, data.y, 300);
            
            // 或者使用 Tween 平滑动画 (二选一，这里用 Tween 更平滑)
            scene.tweens.add({
                targets: other,
                x: data.x,
                y: data.y,
                duration: 200, // 200ms 内移过去
                onUpdate: () => {
                    // 简单的朝向判断
                    if(data.x < other.x) other.flipX = true;
                    else other.flipX = false;
                }
            });
        }
    });

    // 5. 别人断线
    socket.on('disconnect', (id) => { 
        // 尝试移除玩家
        if (otherPlayers[id]) {
            otherPlayers[id].destroy();
            delete otherPlayers[id];
        }
    });
}

// 辅助：添加其他玩家 Sprite
function addOtherPlayer(scene, pInfo) {
    if (otherPlayers[pInfo.id]) return;

    // 创建别人的 sprite
    // 注意：这里暂时用 'student' (自己的头像图) 代替，避免加载错误
    const otherSprite = scene.physics.add.sprite(pInfo.x, pInfo.y, 'student'); 
    otherSprite.setDisplaySize(60, 80);
    otherSprite.setTint(0xcccccc); // 染成灰色，区分这是别人
    
    // 把名字顶在头顶 (Phaser 里的 Text)
    // 稍微复杂点，这里暂时只显示人，为了不报错先不加文字
    
    otherPlayers[pInfo.id] = otherSprite;
}

// ================= UI 交互函数 (保留您原有的按钮功能) =================

// 1. 退出虚拟世界
window.exitVirtualWorld = function() {
    console.log("退出游戏...");
    // 隐藏游戏层
    document.getElementById('virtualWorld').style.display = 'none';
    
    // 显示大厅层
    const lobby = document.getElementById('lobbyView');
    if(lobby) lobby.style.display = 'block';
    
    // 显示底部导航
    const nav = document.querySelector('.nav-bar');
    if(nav) nav.style.display = 'flex'; // 或者是 block，看您原本 CSS
    
    // 断开 Socket 省流量
    if(socket) socket.disconnect();
    
    // 销毁游戏实例释放内存
    if(gameInstance) {
        gameInstance.destroy(true);
        gameInstance = null;
    }
};

// 2. 切换地图模式 (Map View)
window.toggleMapMode = function() {
    window.isMapMode = !window.isMapMode;
    const btn = document.getElementById('btn-map-mode');
    
    if (window.isMapMode) {
        if(btn) { btn.textContent = "🔍 Close Map"; btn.style.background = "#e94560"; }
        // Phaser 摄像机缩放效果
        if (gameInstance && gameInstance.scene.scenes[0]) {
             const cam = gameInstance.scene.scenes[0].cameras.main;
             cam.zoomTo(0.3, 1000); // 缩小镜头看全图
        }
    } else {
        if(btn) { btn.textContent = "🗺️ Map View"; btn.style.background = "rgba(0,0,0, 0.7)"; }
        // 恢复摄像机
        if (gameInstance && gameInstance.scene.scenes[0]) {
             const cam = gameInstance.scene.scenes[0].cameras.main;
             cam.zoomTo(1, 1000); // 恢复正常视角
        }
    }
};

// 3. 兼容性接口 (防止旧代码报错)
window.movePlayerTo = function(x, y) {
    if(player) {
        player.x = x; 
        player.y = y;
    }
};