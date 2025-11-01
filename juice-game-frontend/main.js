import './style.css';

document.querySelector('#app').innerHTML = `
  <div class="container">
    <h1>🎮 学校游戏中心</h1>
    <p>使用你的学校账号登录开始游戏</p>
    <button class="login-btn" id="wixLogin">
      🎫 使用学校账号登录
    </button>
  </div>
`;

document.getElementById('wixLogin').addEventListener('click', () => {
  const clientId = '54186d51-7e8a-483d-b2bd-854aa1ba75ad';
  const redirectUri = 'https://juice-game-server2-production.up.railway.app/auth-callback';
  
  const wixAuthUrl = `https://www.wix.com/installer/install?appId=${clientId}&redirectUrl=${encodeURIComponent(red
.login-btn:hover {
  background-color: #ff5252;
  transform: scale(1.05);
}
