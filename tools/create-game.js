const fs = require('fs');
const path = require('path');

// 读取现有的游戏清单
const manifestPath = path.join(__dirname, '../games/game-manifest.json');
let manifest = { games: [] };

if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

// 新游戏模板
function createGameTemplate(gameId, gameTitle) {
    return {
        id: gameId,
        file: `${gameId}.html`,
        title: gameTitle,
        description: "一个有趣的游戏",
        icon: "🎮",
        version: "v1.0",
        category: "未分类",
        tags: ["游戏"],
        difficulty: "简单",
        duration: "未知",
        players: "1人",
        image: `/images/${gameId}.jpg`,
        color: "#3498db",
        author: "开发者",
        created: new Date().toISOString().split('T')[0],
        updated: new Date().toISOString().split('T')[0],
        requirements: {
            camera: false,
            gyroscope: false,
            audio: false
        }
    };
}

// 添加新游戏
function addNewGame() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log('使用方法: node create-game.js <游戏ID> <游戏标题>');
        console.log('示例: node create-game.js space-shooter "太空射击"');
        return;
    }
    
    const gameId = args[0];
    const gameTitle = args[1];
    
    // 检查是否已存在
    const existingGame = manifest.games.find(game => game.id === gameId);
    if (existingGame) {
        console.log(`❌ 游戏ID "${gameId}" 已存在`);
        return;
    }
    
    // 创建新游戏
    const newGame = createGameTemplate(gameId, gameTitle);
    manifest.games.push(newGame);
    
    // 保存清单
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    console.log(`✅ 成功添加游戏: ${gameTitle} (${gameId})`);
    console.log(`📁 请创建文件: games/${gameId}.html`);
}

addNewGame();