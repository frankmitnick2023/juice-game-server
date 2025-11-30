// virtual_campus.js - 全功能整合版 (地图+缩放+防穿墙+多人联机)

// ================= 全局变量 =================
window.isMapMode = false;      
window.collisionCtx = null;    
const MAP_WIDTH = 2500;     
window.walkTimer = null;       

// ★ 联机相关变量
let socket; 
let otherPlayers = {}; 

// ================= 核心入口函数 =================

window.initVirtualCampus = function() {
    console.log("🚀 启动虚拟校园 (联机版)...");

function create() {
    // 1. 创建角色 (原有的代码)
    player = this.physics.add.sprite(1250, 1200, 'student');
    
    // ... 其他创建代码 ...

    // ★★★ 2. 限制地图边界 (必须放在 create 内部！) ★★★
    // 这里的 2400, 1800 请改为您背景图片的实际像素宽高
    this.physics.world.setBounds(0, 0, 2400, 1800);
    this.cameras.main.setBounds(0, 0, 2400, 1800);
    //player.setCollideWorldBounds(true);
}

const config = {
    type: Phaser.AUTO, // 或者 Phaser.CANVAS
    width: window.innerWidth,
    height: window.innerHeight,
    
    // ★★★ 新增这行配置来消除黄色警告 ★★★
    canvasContext: { willReadFrequently: true },
    
    parent: 'phaser-game',
    physics: {
        default: 'arcade',
        arcade: {
            debug: false // 如果不想看到碰撞框，设为 false
        }
    },
    // ... 其他配置 ...
};


    // 1. 同步头像
    const heroImgSrc = document.getElementById('heroImg') ? document.getElementById('heroImg').src : '';
    const playerImg = document.getElementById('player-img');
    if(playerImg && heroImgSrc) playerImg.src = heroImgSrc;
    
    // 获取名字
    const myName = document.getElementById('userInfo') ? document.getElementById('userInfo').textContent : 'Hero';
    const myPlayer = document.getElementById('my-player');
    const nameLabel = myPlayer.querySelector('div'); // 名字标签
    if(nameLabel) nameLabel.textContent = myName;

    // 2. 初始位置
    window.movePlayerTo(1250, 1200, true); 

    // 3. ★★★ 启动联机连接 ★★★
    initSocketConnection(myName, heroImgSrc);

    // 4. 绑定点击移动
    const viewport = document.getElementById('virtualWorld');
    const mapLayer = document.getElementById('world-map');
    
    viewport.onclick = null; 

    viewport.onclick = function(e) {
        if (e.target.closest('button')) return;

        if(window.isMapMode) {
            window.toggleMapMode(); 
            return;
        }

        const rect = mapLayer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // 碰撞检测
        const player = document.getElementById('my-player');
        const startX = parseFloat(player.style.left) + 25; 
        const startY = parseFloat(player.style.top) + 70;  

        const check = window.checkPathBlocked(startX, startY, clickX, clickY);

        if (check.blocked) {
            window.showBlockMarker(check.x, check.y);
            console.log("🚫 撞墙了");
        } else {
            // 移动自己
            window.movePlayerTo(clickX, clickY);
            window.showClickMarker(clickX, clickY);
            
            // ★★★ 告诉服务器：我移动了 ★★★
            if (socket) {
                socket.emit('playerMovement', { x: clickX, y: clickY });
            }
        }
    };
};

// ================= 联机逻辑 (Socket.io) =================

function initSocketConnection(name, avatar) {

    if (typeof io === 'undefined') return;
    socket = io(); 

    // ★ 监听连接成功
    socket.on('connect', () => {
        console.log("✅ 连上了！");
        // 变绿灯
        const led = document.getElementById('net-status');
        if(led) led.classList.add('online');
        
        // ... 原有的 emit joinGame 代码 ...
    });
    
    // ★ 监听断开
    socket.on('disconnect', () => {
        const led = document.getElementById('net-status');
        if(led) led.classList.remove('online');
    });

    // 检查是否引入了库
    if (typeof io === 'undefined') {
        console.error("❌ Socket.io 库未加载，无法联机！请检查 games.html");
        return;
    }

    // 连接服务器
    socket = io(); 

    // A. 连接成功，发送身份信息
    socket.on('connect', () => {
        console.log("✅ 已连入校园网络 ID:", socket.id);
        const myPlayer = document.getElementById('my-player');
        
        socket.emit('joinGame', {
            x: parseFloat(myPlayer.style.left) || 1250,
            y: parseFloat(myPlayer.style.top) || 1200,
            name: name,
            avatar: avatar
        });
    });

    // B. 显示已存在的其他玩家
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id !== socket.id) {
                addOtherPlayer(players[id]);
            }
        });
    });

    // C. 有新玩家加入
    socket.on('newPlayer', (playerInfo) => {
        console.log("👋 新同学来了:", playerInfo.name);
        addOtherPlayer(playerInfo);
    });

    // D. 别人移动了
    socket.on('playerMoved', (data) => {
        const el = otherPlayers[data.id];
        if (el) {
            // 平滑移动
            el.style.left = (data.x - 25) + 'px';
            el.style.top = (data.y - 70) + 'px';
            
            // 面向判断
            const oldX = parseFloat(el.getAttribute('data-x') || data.x);
            const img = el.querySelector('img');
            if(img) {
                if (data.x < oldX) img.style.transform = "scaleX(-1)";
                else img.style.transform = "scaleX(1)";
            }
            el.setAttribute('data-x', data.x);
            
            // 走路动画
            el.classList.add('is-walking');
            if (el.walkTimeout) clearTimeout(el.walkTimeout);
            el.walkTimeout = setTimeout(() => el.classList.remove('is-walking'), 600);
        }
    });

    // E. 别人离开了
    socket.on('disconnect', (id) => { // 注意：这里的事件名可能需要后端配合改为 'playerDisconnected'，如果后端发的是默认的 disconnect 可能会混淆
        // 修正：后端通常发的是自定义事件，例如 'userLeft'，或者前端监听 socket 默认事件
        // 假设后端写的是 io.emit('disconnect', socket.id); 
        // 但 socket.io 客户端保留字也是 disconnect。
        // 建议后端改成 io.emit('userLeft', socket.id);
        // 这里暂时兼容处理：
        if (otherPlayers[id]) {
            otherPlayers[id].remove();
            delete otherPlayers[id];
        }
    });
    
    // 监听后端发来的 userLeft (推荐)
    socket.on('disconnect', (id) => removePlayer(id)); // 如果后端发的是 id
}

function removePlayer(id) {
    if (otherPlayers[id]) {
        otherPlayers[id].remove();
        delete otherPlayers[id];
    }
}

function addOtherPlayer(playerInfo) {
    // 如果已经存在，就不重复加
    if (otherPlayers[playerInfo.id]) return;

    const mapLayer = document.getElementById('world-map');
    
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.zIndex = '240'; 
    el.style.textAlign = 'center';
    el.style.transition = 'top 0.6s linear, left 0.6s linear'; 
    el.style.left = (playerInfo.x - 25) + 'px';
    el.style.top = (playerInfo.y - 70) + 'px';
    
    // 生成别人的 HTML
    el.innerHTML = `
        <div style="background:rgba(0,0,0,0.4); color:#eee; padding:2px 6px; border-radius:4px; font-size:10px; white-space:nowrap; position:absolute; top:-20px; left:50%; transform:translateX(-50%);">
            ${playerInfo.name}
        </div>
        <img src="${playerInfo.avatar}" style="width:50px; height:auto; filter: drop-shadow(0 5px 5px rgba(0,0,0,0.5));">
    `;
    
    mapLayer.appendChild(el);
    otherPlayers[playerInfo.id] = el;
}



// ================= 通用辅助函数 (保持不变) =================

window.toggleMapMode = function() {
    window.isMapMode = !window.isMapMode;
    const mapLayer = document.getElementById('world-map');
    const btn = document.getElementById('btn-map-mode');
    const radar = document.getElementById('player-radar');
    
    if (window.isMapMode) {
        if(btn) { btn.textContent = "🔍 Close Map"; btn.style.background = "#e94560"; }
        if(radar) radar.classList.add('active');
        const scale = window.innerWidth / MAP_WIDTH;
        const topOffset = (window.innerHeight - (mapLayer.clientHeight || 2000) * scale) / 2;
        mapLayer.style.transform = `translate(0px, ${topOffset}px) scale(${scale})`;
    } else {
        if(btn) { btn.textContent = "🗺️ Map View"; btn.style.background = "rgba(0,0,0, 0.7)"; }
        if(radar) radar.classList.remove('active');
        const player = document.getElementById('my-player');
        const currentX = parseFloat(player.style.left) + 25;
        const currentY = parseFloat(player.style.top) + 70;
        window.updateCamera(currentX, currentY);
    }
};

window.exitVirtualWorld = function() {
    document.getElementById('virtualWorld').style.display = 'none';
    const lobby = document.getElementById('lobbyView');
    if(lobby) lobby.style.display = 'block';
    const nav = document.querySelector('.nav-bar');
    if(nav) nav.style.display = 'flex';
    
    // 退出时断开连接，节省资源
    if(socket) socket.disconnect();
};

window.initCollisionMap = function(imgElement) {
    const canvas = document.getElementById('collision-canvas');
    if(!canvas) return;
    window.collisionCtx = canvas.getContext('2d');
    canvas.width = MAP_WIDTH;
    canvas.height = imgElement.naturalHeight * (MAP_WIDTH / imgElement.naturalWidth);
    window.collisionCtx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
};

window.movePlayerTo = function(x, y, instant=false) {
    const player = document.getElementById('my-player');
    const currentLeft = parseFloat(player.style.left || 0);
    const currentTop = parseFloat(player.style.top || 0);
    const dist = Math.sqrt(Math.pow(x - currentLeft, 2) + Math.pow(y - currentTop, 2));
    const duration = instant ? 0 : (dist / 600); 
    
    player.style.transition = `top ${duration}s linear, left ${duration}s linear`;
    player.style.left = (x - 25) + 'px';
    player.style.top = (y - 70) + 'px';

    if(!instant) {
        player.classList.add('is-walking');
        if(window.walkTimer) clearTimeout(window.walkTimer);
        window.walkTimer = setTimeout(() => player.classList.remove('is-walking'), duration * 1000);
    }

    const img = player.querySelector('img');
    if (x < currentLeft) img.style.transform = "scaleX(-1)";
    else img.style.transform = "scaleX(1)";

    window.updateCamera(x, y, duration);
};

window.updateCamera = function(targetX, targetY, duration=0) {
    const mapLayer = document.getElementById('world-map');
    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;
    const mapX = screenCenterX - targetX;
    const mapY = screenCenterY - targetY;
    mapLayer.style.transition = `transform ${duration}s linear`;
    mapLayer.style.transform = `translate(${mapX}px, ${mapY}px) scale(1)`;
};

window.isWall = function(x, y) {
    if (!window.collisionCtx) return false;
    try {
        const p = window.collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        if (p[0] < 60 && p[1] < 60 && p[2] < 60 && p[3] > 200) return true; 
        return false;
    } catch (e) { return false; }
};

window.checkPathBlocked = function(startX, startY, endX, endY) {
    const steps = 20; 
    const dx = (endX - startX) / steps;
    const dy = (endY - startY) / steps;
    for (let i = 1; i <= steps; i++) {
        const checkX = startX + dx * i;
        const checkY = startY + dy * i;
        if (window.isWall(checkX, checkY)) return { blocked: true, x: checkX, y: checkY };
    }
    return { blocked: false };
};

window.showBlockMarker = function(x, y) {
    const marker = document.getElementById('block-marker');
    if(!marker) return;
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
    marker.style.display = 'block';
    marker.animate([{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }], { duration: 500, fill: 'forwards' });
};

window.showClickMarker = function(x, y) {
    const marker = document.getElementById('click-marker');
    if(!marker) return;
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
    marker.style.display = 'block';
    marker.animate([{ transform: 'translate(-50%, -50%) scale(0.5)', opacity: 1 }, { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0 }], { duration: 400, fill: 'forwards' });
};

// --- ★★★ 必须添加：将函数公开给 HTML 调用 ★★★ ---

// 1. 公开切换地图模式的函数
window.toggleMapMode = function() {
    // 把您原本 toggleMapMode 函数里的代码逻辑写在这里，或者直接调用它
    // 如果您原本是 function toggleMapMode() {...} 
    // 请改为 window.toggleMapMode = function() {...}
    console.log("切换地图模式...");
    const map = document.getElementById('mapOverlay');
    if(map) map.style.display = (map.style.display === 'none' ? 'block' : 'none');
};

// 2. 公开移动玩家的函数 (如果用到)
window.movePlayerTo = function(x, y) {
    if (typeof gameInstance !== 'undefined' && player) {
        player.x = x;
        player.y = y;
    }
};

// 3. 确保初始化函数也是公开的
window.initVirtualCampus = initVirtualCampus;