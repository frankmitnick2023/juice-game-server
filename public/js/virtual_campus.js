// virtual_campus.js - 终极修复版

// 全局变量
let gameInstance; 
let player; 
let socket;
let otherPlayers = {}; 

window.initVirtualCampus = function() {
    console.log("🚀 启动虚拟校园 (Phaser修复版)...");

    // 获取当前用户信息
    const heroImg = document.getElementById('heroImg');
    const avatarUrl = heroImg ? heroImg.src : '/avatars/boy_junior_uniform.png'; // 默认头像
    const userName = document.getElementById('userInfo') ? document.getElementById('userInfo').textContent : 'Hero';

    // 1. Phaser 游戏配置
    const config = {
        type: Phaser.AUTO,
        parent: 'phaser-game', // 对应 HTML 里的 div id
        width: window.innerWidth,
        height: window.innerHeight,
        
        // ★ 消除黄色警告的配置
        canvasContext: { willReadFrequently: true },
        
        physics: {
            default: 'arcade',
            arcade: {
                debug: false // 设为 true 可以看到碰撞框调试
            }
        },
        scene: {
            preload: preload,
            create: create,
            update: update
        }
    };

    // 2. 内部函数：预加载资源
    function preload() {
        // ★ 这里请确认您的地图背景路径，如果不对请修改 ★
        // 如果没有背景图，屏幕会是黑的。这里暂时用头像当占位符，建议换成您的地图路径
        this.load.image('map_bg', '/images/virtual_campus_map.png'); 
        
        // 加载玩家自己的头像
        this.load.image('student', avatarUrl);
    }

    // 3. 内部函数：创建游戏世界 (核心逻辑)
    function create() {
        // A. 创建地图 (背景) - 假设地图宽2400 高1800
        // 如果图片加载失败，这行可能不显示，但不影响人物移动
        try { this.add.image(0, 0, 'map_bg').setOrigin(0, 0).setDisplaySize(2400, 1800); } catch(e){}

        // B. 设置世界物理边界 (防止走出地图)
        // ★★★ 这里就是您要的“防走出”功能 ★★★
        this.physics.world.setBounds(0, 0, 2400, 1800);

        // C. 创建玩家
        player = this.physics.add.sprite(1250, 1200, 'student');
        player.setDisplaySize(60, 80); // 调整人物大小
        player.setCollideWorldBounds(true); // ★ 开启撞墙限制

        // D. 摄像机跟随玩家
        this.cameras.main.setBounds(0, 0, 2400, 1800);
        this.cameras.main.startFollow(player);

        // E. ★★★ 鼠标点击移动逻辑 (之前报错就是因为这几行放错了位置) ★★★
        this.input.on('pointerdown', (pointer) => {
            // 只有点击顶部菜单以下才移动
            if (pointer.y > 50) {
                // 让物理引擎移动人物到点击的坐标
                this.physics.moveTo(player, pointer.worldX, pointer.worldY, 300); // 300是速度
                
                // 记录目标点，用于在 update 里判断是否停止
                player.targetX = pointer.worldX;
                player.targetY = pointer.worldY;
                player.isMoving = true;

                // 联机同步：告诉服务器我动了
                if(socket) socket.emit('playerMovement', { x: pointer.worldX, y: pointer.worldY });
            }
        }, this); // 注意最后的 this

        // F. 启动联机
        initSocketConnection(userName, avatarUrl, this);
    }

    // 4. 内部函数：每帧更新
    function update() {
        // 判断是否到达目标点，到达则停止
        if (player && player.isMoving) {
            const dist = Phaser.Math.Distance.Between(player.x, player.y, player.targetX, player.targetY);
            if (dist < 10) {
                player.body.reset(player.targetX, player.targetY); // 强制停在目标点
                player.isMoving = false;
            }
        }
    }

    // 5. 销毁旧游戏实例并新建
    if(gameInstance) gameInstance.destroy(true);
    gameInstance = new Phaser.Game(config);
};

// ================= 联机逻辑 (Socket.io) =================

function initSocketConnection(name, avatar, scene) {
    if (typeof io === 'undefined') return;
    
    // 避免重复连接
    if(socket && socket.connected) socket.disconnect();
    
    socket = io(); 

    // 1. 连接成功
    socket.on('connect', () => {
        console.log("✅ 连上了！Socket ID:", socket.id);
        // 变绿灯 (如果有这个UI)
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

    // 2. 有新玩家加入
    socket.on('newPlayer', (pInfo) => {
        addOtherPlayer(scene, pInfo);
    });

    // 3. 显示已有的其他玩家
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) addOtherPlayer(scene, players[id]);
        });
    });

    // 4. 别人移动了
    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.id]) {
            // 平滑移动别人的位置
            scene.physics.moveTo(otherPlayers[data.id], data.x, data.y, 300);
            // 简单处理：设定一个延时停止，或者像 update 里那样判断距离
            // 这里为了简化，直接用 tween 动画可能更平滑
            scene.tweens.add({
                targets: otherPlayers[data.id],
                x: data.x,
                y: data.y,
                duration: 200
            });
        }
    });

    // 5. 别人断线了
    socket.on('disconnect', (id) => { 
        // 注意：这里监听的是 socket 的系统事件，参数可能不对
        // 如果后端没有发 'userLeft'，通常 socket.io 客户端无法直接通过 disconnect 知道是谁断了
        // 这里暂时保留，如果后端发的是 io.emit('disconnect', id)，则生效
        if (otherPlayers[id]) {
            otherPlayers[id].destroy();
            delete otherPlayers[id];
        }
    });
}

function addOtherPlayer(scene, pInfo) {
    if (otherPlayers[pInfo.id]) return;

    // 创建别人的 Sprite
    // 注意：这里为了防报错，别人的头像也暂时用 'student' (自己的头像) 代替
    // 完美做法是 preload 里预加载所有头像，或者用 Loader 动态加载
    const otherSprite = scene.physics.add.sprite(pInfo.x, pInfo.y, 'student'); 
    otherSprite.setDisplaySize(60, 80);
    otherSprite.setTint(0x999999); // 染成灰色以区分
    otherPlayers[pInfo.id] = otherSprite;
}

// 确保函数公开
window.toggleMapMode = function() { console.log("地图模式暂未适配 Phaser 版"); };