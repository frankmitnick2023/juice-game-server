// virtual_campus.js

// 全局变量，用于退出时销毁
    let renderer, scene, camera, cube, animationId;

// 配置参数
const CONFIG = {
    speed: 200, // 移动速度
    debug: true, // ★ 开启调试模式：会显示红色的墙壁和传送门，正式发布时改为 false
    scale: 0.8 // 地图缩放比例，根据图片大小调整
};

// 1. 基础场景类 (包含通用逻辑：移动、墙壁、传送)
class BaseScene extends Phaser.Scene {
    constructor(key, mapImage) {
        super(key);
        this.mapImage = mapImage;
        this.player = null;
        this.cursors = null;
        this.walls = null;
        this.portals = null;
    }

    preload() {
        // 加载地图和人物
        this.load.image('map_ground', '/images/map_ground.png');
        this.load.image('map_first', '/images/map_first.png');
        
        // 如果没有 hero_sprite.png，代码会自动生成一个方块代替，不用担心报错
        this.load.image('hero', '/images/hero_sprite.png');
    }

    create() {
        // A. 添加地图背景
        const bg = this.add.image(0, 0, this.mapImage).setOrigin(0, 0).setScale(CONFIG.scale);
        // 设置世界边界 (根据缩放后的图片大小)
        this.physics.world.setBounds(0, 0, bg.displayWidth, bg.displayHeight);

        // B. 创建空气墙组 (静态物体)
        this.walls = this.physics.add.staticGroup();
        this.createWalls(); // 由子类具体实现

        // C. 创建传送门组
        this.portals = this.physics.add.staticGroup();
        this.createPortals(); // 由子类具体实现

        // D. 创建玩家
        // 检查是否有 hero 图片，没有就画个红方块
        if (this.textures.exists('hero')) {
            this.player = this.physics.add.sprite(100, 300, 'hero').setScale(0.5); // 初始坐标 (100,300)
        } else {
            const graphics = this.make.graphics().fillStyle(0xe94560).fillRect(0, 0, 32, 32);
            graphics.generateTexture('hero_rect', 32, 32);
            this.player = this.physics.add.sprite(200, 500, 'hero_rect'); // 默认出生在门口附近
        }
        
        this.player.setCollideWorldBounds(true); // 不准跑出地图

        // E. 碰撞逻辑
        this.physics.add.collider(this.player, this.walls); // 碰到墙停下
        
        // 碰到传送门触发 overlapping
        this.physics.add.overlap(this.player, this.portals, (player, portal) => {
            this.handlePortal(portal);
        });

        // F. 摄像机跟随
        this.cameras.main.setBounds(0, 0, bg.displayWidth, bg.displayHeight);
        this.cameras.main.startFollow(this.player, true, 0.09, 0.09);
        this.cameras.main.setZoom(1.2); // 稍微放大一点看细节

        // G. 键盘控制
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    }

    update() {
        // 简单的 4 方向移动逻辑
        this.player.setVelocity(0);

        if (this.cursors.left.isDown) this.player.setVelocityX(-CONFIG.speed);
        else if (this.cursors.right.isDown) this.player.setVelocityX(CONFIG.speed);

        if (this.cursors.up.isDown) this.player.setVelocityY(-CONFIG.speed);
        else if (this.cursors.down.isDown) this.player.setVelocityY(CONFIG.speed);
        
        // 隐藏提示框 (如果离开了传送区域)
        const touching = this.physics.overlap(this.player, this.portals);
        if (!touching) {
            document.getElementById('interactionTip').style.display = 'none';
        }
    }

    // 辅助函数：画墙 (方便你根据图纸坐标填空)
    addWall(x, y, w, h) {
        const wall = this.walls.create(x, y, null).setOrigin(0,0).setVisible(CONFIG.debug);
        wall.body.setSize(w, h); // 设置碰撞体积
        // 如果开启 debug，画个红框给你看
        if (CONFIG.debug) {
            this.add.rectangle(x + w/2, y + h/2, w, h, 0xff0000, 0.3);
        }
    }

    // 辅助函数：画传送门
    addPortal(x, y, w, h, type, target) {
        // type: 'stairs' (切地图) 或 'game' (进游戏)
        // target: 目标场景名 或 游戏ID
        const portal = this.portals.create(x, y, null).setOrigin(0,0).setVisible(false);
        portal.body.setSize(w, h);
        portal.setData('type', type);
        portal.setData('target', target);
        
        // Debug 显示
        if (CONFIG.debug) {
            const color = type === 'stairs' ? 0x00ff00 : 0x0000ff; // 楼梯绿色，游戏蓝色
            this.add.rectangle(x + w/2, y + h/2, w, h, color, 0.3);
            this.add.text(x, y, target, { fontSize: '12px', fill: '#fff', backgroundColor: '#000' });
        }
    }

    handlePortal(portal) {
        const type = portal.getData('type');
        const target = portal.getData('target');

        if (type === 'stairs') {
            // 立即切换楼层
            this.scene.start(target);
        } else if (type === 'game') {
            // 显示提示
            const tip = document.getElementById('interactionTip');
            tip.style.display = 'block';
            tip.textContent = `SPACE to play: ${target}`;
            
            // 按空格进入
            if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
                // 调用你原来 play.html 的逻辑
                window.location.href = `/play/${target}`;
            }
        }
    }
}

// 2. 一楼场景 (Ground Floor)
class GroundScene extends BaseScene {
    constructor() { super('GroundScene', 'map_ground'); }

    createWalls() {
        // ★★★ 这里最关键！根据你的图纸 (Ground Floor)，调整这些数字 ★★★
        // 参数: x, y, width, height
        
        // 示例：围住整个外墙 (假设地图大概 2000x1500)
        this.addWall(0, 0, 2000, 50); // 上边界
        this.addWall(0, 0, 50, 1500); // 左边界
        this.addWall(0, 1450, 2000, 50); // 下边界
        this.addWall(1950, 0, 50, 1500); // 右边界
        
        // 示例：Reception (接待处) 的墙
        this.addWall(800, 900, 200, 20); 
        this.addWall(800, 900, 20, 200);

        // 你需要运行游戏，看着红框，把所有黑色实线的墙都补上！
    }

    createPortals() {
        // 楼梯 (通往二楼) - 假设楼梯在地图中间
        this.addPortal(1000, 600, 100, 100, 'stairs', 'FirstScene');

        // 游戏入口 (对应你的图纸房间)
        // Classroom 4 -> Ballet Pro
        this.addPortal(400, 300, 150, 150, 'game', 'ballet-pro');
        
        // Classroom 3 -> Jazz
        this.addPortal(800, 300, 150, 150, 'game', 'demo-game');
    }
}

// 3. 二楼场景 (First Floor)
class FirstScene extends BaseScene {
    constructor() { super('FirstScene', 'map_first'); }

    createWalls() {
        // 二楼的墙壁...
        this.addWall(0, 0, 2000, 50); 
        // ... 继续补充
    }

    createPortals() {
        // 下楼的楼梯
        this.addPortal(1000, 600, 100, 100, 'stairs', 'GroundScene');
        
        // Classroom 8 -> K-POP
        this.addPortal(500, 400, 150, 150, 'game', 'rhythm-challenger');
    }
}

// 4. 初始化函数 (被 games.html 调用)
// 启动虚拟校园 (带 3D 效果)
    function initVirtualCampus() {
        console.log("🚀 启动 3D 引擎...");
        const container = document.getElementById('canvas-container');
        
        // 防止重复初始化
        if (container.childNodes.length > 0) return;

        // 1. 创建场景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e); // 深蓝色背景

        // 2. 创建相机
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.z = 5;

        // 3. 创建渲染器
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(renderer.domElement);

        // 4. 创建一个立方体 (代表未来的校园建筑)
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshBasicMaterial({ color: 0xe94560, wireframe: true });
        cube = new THREE.Mesh(geometry, material);
        scene.add(cube);

        // 5. 开始动画循环
        function animate() {
            animationId = requestAnimationFrame(animate);
            
            // 让立方体转起来
            cube.rotation.x += 0.01;
            cube.rotation.y += 0.01;

            renderer.render(scene, camera);
        }
        animate();
    }

    // 退出虚拟大厅
    function exitVirtualWorld() {
        // 1. 停止动画
        if (animationId) cancelAnimationFrame(animationId);
        
        // 2. 清理 DOM
        const container = document.getElementById('canvas-container');
        if (container) container.innerHTML = ''; // 清空 Canvas
        
        // 3. 切换界面
        document.getElementById('virtualWorld').style.display = 'none';
        
        // 根据之前的逻辑，这里决定回大厅还是回游戏列表
        // 通常建议回 Battle Mode 的上一级，也就是个人主页
        const lobby = document.getElementById('lobbyView');
        if(lobby) lobby.style.display = 'block';
        
        // 恢复底部导航栏 (如果在全屏模式下被遮挡了)
        const nav = document.querySelector('.nav-bar');
        if(nav) nav.style.display = 'flex';
        
        // 销毁全局变量
        gameInstance = null;
    }