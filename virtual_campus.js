// virtual_campus.js - 2D 虚拟大厅核心逻辑

// ================= 全局变量 =================
let isMapMode = false;      // 是否处于地图概览模式
let collisionCtx = null;    // 碰撞检测画布上下文
const MAP_WIDTH = 2500;     // 地图原始宽度 (需与 HTML img width 一致)
let walkTimer = null;       // 走路动画定时器

// ================= 核心功能函数 =================

/**
 * 启动虚拟校园
 * 绑定在 window 对象上，供 HTML 直接调用
 */
window.initVirtualCampus = function() {
    console.log("🚀 启动虚拟校园 (2D 大地图模式)...");

    // 1. 同步头像：把大厅的头像复制进来
    const heroImgSrc = document.getElementById('heroImg') ? document.getElementById('heroImg').src : '';
    const playerImg = document.getElementById('player-img');
    if(playerImg && heroImgSrc) {
        playerImg.src = heroImgSrc;
    }

    // 2. 初始位置：设置在地图中间 (你可以根据需要修改 x, y)
    movePlayerTo(1250, 1200, true); 

    // 3. 绑定点击移动事件
    const viewport = document.getElementById('virtualWorld');
    const mapLayer = document.getElementById('world-map');
    
    // 清除旧的事件绑定，防止重复
    viewport.onclick = null; 

    viewport.onclick = function(e) {
        // 如果点到了按钮 (Exit 或 Map View)，不执行移动
        if (e.target.closest('button')) return;

        // 如果在地图概览模式下点击，则切换回正常视角
        if(isMapMode) {
            window.toggleMapMode(); 
            return;
        }

        // 计算点击点在“地图图层”上的坐标
        const rect = mapLayer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // --- 碰撞检测 ---
        // 获取当前人物位置作为起点
        const player = document.getElementById('my-player');
        const startX = parseFloat(player.style.left) + 25; // +25 是因为人物宽50，中心点在25
        const startY = parseFloat(player.style.top) + 70;  // +70 是脚底位置

        const check = checkPathBlocked(startX, startY, clickX, clickY);

        if (check.blocked) {
            // 撞墙了
            showBlockMarker(check.x, check.y);
            console.log("🚫 前方有墙壁 (颜色检测)");
        } else {
            // 路通畅，移动！
            movePlayerTo(clickX, clickY);
            showClickMarker(clickX, clickY);
        }
    };
};

/**
 * 切换地图概览模式 (放大/缩小)
 */
window.toggleMapMode = function() {
    isMapMode = !isMapMode;
    const mapLayer = document.getElementById('world-map');
    const btn = document.getElementById('btn-map-mode');
    const player = document.getElementById('my-player');
    const radar = document.getElementById('player-radar'); // 光圈
    
    if (isMapMode) {
        // === 进入地图概览模式 (Zoom Out) ===
        if(btn) {
            btn.textContent = "🔍 Close Map";
            btn.style.background = "#e94560";
        }
        
        // 开启闪烁光圈
        if(radar) radar.classList.add('active');

        // 计算缩放比例：让地图宽度适应屏幕宽度
        const scale = window.innerWidth / MAP_WIDTH;
        // 垂直居中计算
        const screenHeight = window.innerHeight;
        const visualHeight = (mapLayer.clientHeight || 2000) * scale;
        const topOffset = (screenHeight - visualHeight) / 2;
        
        mapLayer.style.transform = `translate(0px, ${topOffset}px) scale(${scale})`;
        
        // 更新提示语
        const tip = document.querySelector('#game-tip span');
        if(tip) tip.textContent = "Map Mode: You are here (Flashing)";
        
    } else {
        // === 恢复正常视角 (Normal View) ===
        if(btn) {
            btn.textContent = "🗺️ Map View";
            btn.style.background = "rgba(0,0,0, 0.7)";
        }
        
        // 关闭光圈
        if(radar) radar.classList.remove('active');

        // 立即把镜头切回人物位置
        const currentX = parseFloat(player.style.left) + 25;
        const currentY = parseFloat(player.style.top) + 70;
        updateCamera(currentX, currentY);
        
        const tip = document.querySelector('#game-tip span');
        if(tip) tip.textContent = "Tap to walk";
    }
};

/**
 * 退出虚拟大厅
 */
window.exitVirtualWorld = function() {
    document.getElementById('virtualWorld').style.display = 'none';
    const lobby = document.getElementById('lobbyView');
    if(lobby) lobby.style.display = 'block';
    
    // 恢复底部导航栏
    const nav = document.querySelector('.nav-bar');
    if(nav) nav.style.display = 'flex';
};

/**
 * 初始化碰撞检测地图 (在 HTML img onload 中调用)
 */
window.initCollisionMap = function(imgElement) {
    const canvas = document.getElementById('collision-canvas');
    if(!canvas) return;
    
    collisionCtx = canvas.getContext('2d');
    canvas.width = MAP_WIDTH;
    // 保持长宽比
    canvas.height = imgElement.naturalHeight * (MAP_WIDTH / imgElement.naturalWidth);
    
    // 把地图画到隐藏的 Canvas 上
    collisionCtx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
    console.log("🧱 墙壁检测系统已就绪");
};

// ================= 辅助逻辑函数 =================

function movePlayerTo(x, y, instant=false) {
    const player = document.getElementById('my-player');
    
    // 1. 计算距离和时间
    const currentLeft = parseFloat(player.style.left || 0);
    const currentTop = parseFloat(player.style.top || 0);
    const dist = Math.sqrt(Math.pow(x - currentLeft, 2) + Math.pow(y - currentTop, 2));
    
    // 速度：每 600px 走 1 秒
    const duration = instant ? 0 : (dist / 600); 
    
    // 2. 设置 CSS 移动
    player.style.transition = `top ${duration}s linear, left ${duration}s linear`;
    // 修正中心点：人物宽50(一半25)，高约80(脚底偏移70)
    player.style.left = (x - 25) + 'px';
    player.style.top = (y - 70) + 'px';

    // 3. 走路颠簸动画
    if(!instant) {
        player.classList.add('is-walking');
        if(walkTimer) clearTimeout(walkTimer);
        walkTimer = setTimeout(() => player.classList.remove('is-walking'), duration * 1000);
    }

    // 4. 面向调整 (向左走还是向右走)
    const img = player.querySelector('img');
    if (x < currentLeft) img.style.transform = "scaleX(-1)";
    else img.style.transform = "scaleX(1)";

    // 5. 摄像机跟随 (移动地图背景)
    updateCamera(x, y, duration);
}

function updateCamera(targetX, targetY, duration=0) {
    const mapLayer = document.getElementById('world-map');
    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = window.innerHeight / 2;
    
    // 地图偏移 = 屏幕中心 - 目标坐标
    const mapX = screenCenterX - targetX;
    const mapY = screenCenterY - targetY;
    
    mapLayer.style.transition = `transform ${duration}s linear`;
    mapLayer.style.transform = `translate(${mapX}px, ${mapY}px) scale(1)`;
}

// 检测单点是否为墙
function isWall(x, y) {
    if (!collisionCtx) return false;
    try {
        // 获取像素数据
        const p = collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        // 判断黑色/深灰色线条：RGB 都 < 60 且 Alpha > 200
        if (p[0] < 60 && p[1] < 60 && p[2] < 60 && p[3] > 200) {
            return true; 
        }
        return false;
    } catch (e) { return false; }
}

// 检测路径是否被阻挡
function checkPathBlocked(startX, startY, endX, endY) {
    const steps = 20; // 采样点数量
    const dx = (endX - startX) / steps;
    const dy = (endY - startY) / steps;
    
    for (let i = 1; i <= steps; i++) {
        const checkX = startX + dx * i;
        const checkY = startY + dy * i;
        if (isWall(checkX, checkY)) {
            return { blocked: true, x: checkX, y: checkY };
        }
    }
    return { blocked: false };
}

// UI 效果：显示红色阻挡标记
function showBlockMarker(x, y) {
    const marker = document.getElementById('block-marker');
    if(!marker) return;
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
    marker.style.display = 'block';
    
    marker.animate([
        { transform: 'translate(-50%, -50%) scale(1)' },
        { transform: 'translate(-60%, -50%) scale(1.2)' },
        { transform: 'translate(-40%, -50%) scale(1.2)' },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }
    ], { duration: 500, fill: 'forwards' });
}

// UI 效果：显示绿色点击涟漪
function showClickMarker(x, y) {
    const marker = document.getElementById('click-marker');
    if(!marker) return;
    marker.style.left = x + 'px';
    marker.style.top = y + 'px';
    marker.style.display = 'block';
    
    marker.animate([
        { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0 }
    ], { duration: 400, fill: 'forwards' });
}