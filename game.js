// ==== DOM CACHE ==== //
const muteBtnHome = document.getElementById('muteToggleHome');
const usernameEl = document.getElementById('username');
const loginBtn = document.getElementById('loginBtn');
const startBtn = document.getElementById('startBtn');
const homeBtn = document.getElementById('homeBtn');
const playAgainBtn = document.getElementById('playAgainBtn');
const pauseOverlayEl = document.getElementById('pause-overlay');
const userInfoEl = document.getElementById('user-info');
const viewLeaderboardBtn = document.getElementById('viewLeaderboardBtn');
const leaderboardScreenEl = document.getElementById('leaderboard-screen');
const leaderboardEntriesHomeEl = document.getElementById('leaderboardEntriesHome');
const closeLeaderboardBtn = document.getElementById('closeLeaderboardBtn');
const gameOverScreenEl = document.getElementById('game-over-screen');
const leaderboardEntriesEl = document.getElementById('leaderboardEntries');
const leaderboardEl = document.getElementById('leaderboard');
const rankMessageEl = document.getElementById('rankMessage');
const finalScoreEl = document.getElementById('finalScore');
const bestScoreEl = document.getElementById('bestScore');
const startScreenEl = document.getElementById('start-screen');
const fadeScreenEl = document.getElementById('fade-screen');

// ==== PI SDK ==== //
let piInitPromise = null;
function initPi() {
  if (!piInitPromise) {
    piInitPromise = Pi.init({ version: "2.0", sandbox: true });
  }
  return piInitPromise;
}
const scopes = ['username'];
let piUsername = 'Guest';
let highScore = 0;
let useLocalHighScore = true;

// ==== SFX/State ==== //
let sfx = {}, isMuted = false;
const currentMuteIcon = () => isMuted ? 'assets/icon-unmute.svg' : 'assets/icon-mute.svg';

// ==== FADE HELPERS ==== //
function fadeInElement(el, duration = 500, displayType = 'flex') {
  if (!el) return;
  el.style.opacity = 0;
  el.style.display = displayType;
  requestAnimationFrame(() => {
    el.style.transition = `opacity ${duration}ms ease`;
    el.style.opacity = 1;
  });
}
function fadeOutElement(el, duration = 500) {
  if (!el) return;
  el.style.transition = `opacity ${duration}ms ease`;
  el.style.opacity = 0;
  setTimeout(() => {
    el.style.display = 'none';
  }, duration);
}
function fadeIn(callback, duration = 600) {
  if (!fadeScreenEl) return callback?.();
  fadeScreenEl.classList.add('fade-in');
  setTimeout(() => callback?.(), duration);
}
function fadeOut(callback, duration = 600) {
  if (!fadeScreenEl) return callback?.();
  fadeScreenEl.classList.remove('fade-in');
  setTimeout(() => callback?.(), duration);
}

// ==== PI AUTH ==== //
function onIncompletePaymentFound(payment) {
  console.log('Incomplete payment found:', payment);
}
async function initAuth() {
  await initPi();
  try {
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
    piUsername = auth.user.username;
    if (usernameEl) usernameEl.innerText = piUsername;
    if (loginBtn) loginBtn.style.display = 'none';
    useLocalHighScore = false;
    const res = await fetch(`/api/leaderboard/${piUsername}`);
    if (res.ok) {
      const entry = await res.json();
      highScore = entry.score;
    } else {
      highScore = 0;
    }
    localStorage.setItem('tricky_high_score', highScore);
    if (typeof bestScoreText !== 'undefined') bestScoreText.setText('Best: ' + highScore);
  } catch (e) {
    console.log('Not signed in:', e);
  }
}
initAuth();
if (loginBtn) loginBtn.addEventListener('click', initAuth);

// ==== LEADERBOARD ==== //
async function showHomeLeaderboard() {
  if (!leaderboardEntriesHomeEl) return;
  while (leaderboardEntriesHomeEl.firstChild) leaderboardEntriesHomeEl.removeChild(leaderboardEntriesHomeEl.firstChild);
  try {
    const data = await fetch('/api/leaderboard?top=100').then(r=>r.json());
    data.forEach((e, i) => {
      const li = document.createElement('li');
      li.setAttribute('data-rank', `#${i + 1}`);
      li.innerHTML = `<strong>${e.username}</strong><strong>${e.score}</strong>`;
      leaderboardEntriesHomeEl.appendChild(li);
    });
    if (leaderboardScreenEl) leaderboardScreenEl.style.display = 'flex';
  } catch(e) {
    // Handle API error gracefully
  }
}
if (viewLeaderboardBtn) viewLeaderboardBtn.addEventListener('click', showHomeLeaderboard);
if (closeLeaderboardBtn) closeLeaderboardBtn.addEventListener('click', ()=>{
  if (leaderboardScreenEl) leaderboardScreenEl.style.display = 'none';
});

// ==== GAME LOGIC STATE ==== //
const LANES = [];
let gameStarted = false, gameOver = false, gamePaused = false;
let direction = 1, angle = 0, radius = 100, speed = 3, maxSpeed = 6;
let circle1, circle2, score = 0;
let muteIcon, bestScoreText, scoreText, pauseIcon, countdownText;
let spawnTimer;
let obstacles, points;

// ==== OBJECT POOLING GROUPS ==== //
let obstaclePool, pointPool, pointGlowPool;

// ==== PHASER CONFIG ==== //
const config = {
  type: Phaser.AUTO,
  transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: { key: 'default', preload, create, update }
};
window.game = new Phaser.Game(config);

// ==== PRELOAD ==== //
function preload() {
  this.load.audio('explode', 'assets/explode.wav');
  this.load.audio('move', 'assets/move.wav');
  this.load.audio('point', 'assets/point.wav');
  this.load.audio('newBest', 'assets/new_best.wav');
  this.load.audio('uiClick', 'assets/ui_click_subtle.wav');
  this.load.audio('pauseWhoosh', 'assets/pause_whoosh_subtle.wav');
  this.load.image('iconPause', 'assets/icon-pause.svg');
  this.load.image('iconPlay', 'assets/icon-play.svg');
  this.load.image('iconMute', 'assets/icon-mute.svg');
  this.load.image('iconUnmute', 'assets/icon-unmute.svg');
}

// ==== CREATE ==== //
function create() {
  // ---- SETUP ---- //
  const cam = this.cameras.main;
  const cx = cam.centerX, cy = cam.centerY;
  LANES[0] = cy - radius; LANES[1] = cy; LANES[2] = cy + radius;

  // ---- TEXTURES ---- //
  if (this.textures.exists('orb')) this.textures.remove('orb');
  this.make.graphics({ add: false })
    .fillStyle(0xffffff, 0.04).fillCircle(50, 50, 30)
    .fillStyle(0xffffff, 1).fillCircle(50, 50, 20)
    .generateTexture('orb', 100, 100).destroy();
  this.make.graphics({ add: false })
    .fillStyle(0x0D1B2A, 1).fillRoundedRect(0, 0, 50, 50, 8)
    .generateTexture('obstacle', 50, 50).destroy();
  this.make.graphics({ add: false })
    .fillStyle(0xffffff, 0.25).fillCircle(40, 40, 40)
    .generateTexture('pointGlow', 80, 80).destroy();
  this.make.graphics({ add: false })
    .fillStyle(0xffffff, 1)
    .beginPath().moveTo(25, 0).lineTo(50, 25).lineTo(25, 50).lineTo(0, 25)
    .closePath().fillPath()
    .generateTexture('point', 50, 50).destroy();

  // ---- OBJECT POOLS ---- //
  obstaclePool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 30, runChildUpdate: false });
  pointPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 15, runChildUpdate: false });
  pointGlowPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 15, runChildUpdate: false });

  // ---- ORBIT SPRITES ---- //
  circle1 = this.add.image(0, 0, 'orb'); this.physics.add.existing(circle1);
  circle1.body.setCircle(22.5, 27.5, 27.5);
  circle2 = this.add.image(0, 0, 'orb'); this.physics.add.existing(circle2);
  circle2.body.setCircle(22.5, 27.5, 27.5);

  // ---- TRAIL ---- //
  if (this.trail) { this.trail.destroy(); this.trail = null; }
  this.trail = this.add.particles('orb');
  [circle1, circle2].forEach(c => this.trail.createEmitter({
    follow: c, lifespan: 300, speed: 0,
    scale: { start: 0.3, end: 0 }, alpha: { start: 0.4, end: 0 },
    frequency: 50, blendMode: 'ADD'
  }));
  this.events.on('shutdown', () => {
    if (this.trail) {
      this.trail.destroy();
      this.trail = null;
    }
    if (spawnTimer) spawnTimer.remove(false);
  });

  // ---- GAME OBJECT GROUPS ---- //
  obstacles = this.physics.add.group();
  points = this.physics.add.group();

  // ---- HUD ---- //
  scoreText = this.add.text(16, 16, 'Score: 0', {
    fontFamily: 'Poppins', fontSize: '36px',
    color: '#fff', stroke: '#000', strokeThickness: 4
  }).setDepth(2).setVisible(false);
  bestScoreText = this.add.text(16, 64, 'Best: ' + highScore, {
    fontFamily: 'Poppins', fontSize: '28px',
    color: '#fff', stroke: '#000', strokeThickness: 3
  }).setDepth(2).setVisible(false);

  if (useLocalHighScore) {
    highScore = Number(localStorage.getItem('tricky_high_score')) || 0;
    if (bestScoreText) bestScoreText.setText('Best: ' + highScore);
  }

  pauseIcon = this.add.image(cam.width - 40, 40, 'iconPause')
    .setInteractive().setDepth(3).setVisible(false);
  muteIcon = this.add.image(cam.width - 100, 40, 'iconUnmute')
    .setInteractive().setDepth(3).setVisible(false);
  window.muteIcon = muteIcon;
  this.sound.mute = isMuted;
  muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
  if (muteBtnHome) muteBtnHome.src = currentMuteIcon();
  countdownText = this.add.text(cx, cy, '', {
    fontFamily: 'Poppins', fontSize: '96px',
    color: '#fff', stroke: '#000', strokeThickness: 6
  }).setOrigin(0.5).setDepth(5).setVisible(false);

  // ---- SFX ---- //
  sfx.explode = this.sound.add('explode');
  sfx.move = this.sound.add('move');
  sfx.point = this.sound.add('point');
  sfx.newBest = this.sound.add('newBest');
  sfx.uiClick = this.sound.add('uiClick');
  sfx.pauseWhoosh = this.sound.add('pauseWhoosh');

  // ---- MUTE HANDLERS ---- //
  muteIcon.on('pointerdown', () => {
    isMuted = !isMuted;
    this.sound.mute = isMuted;
    muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
    if (muteBtnHome) muteBtnHome.src = currentMuteIcon();
    if (!isMuted) sfx.uiClick.play();
  });

  // ---- PAUSE/PLAY HANDLERS ---- //
  pauseIcon.on('pointerdown', (_, x, y, e) => {
    e.stopPropagation();
    if (!gameStarted || gameOver) return;
    if (!gamePaused) {
      gamePaused = true;
      pauseIcon.setTexture('iconPlay');
      sfx.pauseWhoosh.play();
      if (pauseOverlayEl) pauseOverlayEl.style.display = 'flex';
      this.physics.pause();
    } else {
      sfx.pauseWhoosh.play();
      if (pauseOverlayEl) pauseOverlayEl.style.display = 'none';
      let count = 3;
      countdownText.setText(count).setVisible(true);
      this.time.addEvent({
        delay: 1000, repeat: 2,
        callback: () => {
          count--;
          if (count > 0) countdownText.setText(count);
          else {
            countdownText.setVisible(false);
            gamePaused = false;
            pauseIcon.setTexture('iconPause');
            this.physics.resume();
          }
        }
      });
    }
  });

  // ---- INPUT ---- //
  this.input.on('pointerdown', () => {
    if (gameStarted && !gameOver && !gamePaused) {
      direction *= -1;
      sfx.move.play();
      this.tweens.add({
        targets: [circle1, circle2],
        scaleX: 1.15, scaleY: 1.15,
        yoyo: true, duration: 100, ease: 'Quad.easeInOut'
      });
    }
  });

  // ---- COLLISIONS ---- //
  this.physics.add.overlap(circle1, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle2, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle1, points, collectPoint, null, this);
  this.physics.add.overlap(circle2, points, collectPoint, null, this);

  // ---- SPEED RAMP ---- //
  this.time.addEvent({
    delay: 1000, loop: true,
    callback: () => {
      if (gameStarted && !gameOver && !gamePaused) {
        if (speed > 1.5) speed += 0.006;
        else if (speed >= 1.2) speed += 0.0015;
      }
    }
  });

  // ---- SPAWN SCHEDULER ---- //
  this.scheduleSpawn = scheduleSpawn.bind(this);
  this.scheduleSpawn();

  // ---- START/HOME/PLAY AGAIN HANDLERS ---- //
  if (startBtn) startBtn.onclick = () => handleStartGame.call(this);
  if (homeBtn) homeBtn.onclick = () => handleGoHome.call(this);
  if (playAgainBtn) playAgainBtn.onclick = () => handlePlayAgain.call(this);
}

// ---- SPAWN FUNCTIONS ---- //
function getSpawnInterval() {
  const t = Phaser.Math.Clamp((speed - 3) / (maxSpeed - 3), 0, 1);
  return Phaser.Math.Linear(1500, 500, t);
}
function scheduleSpawn() {
  spawnTimer = this.time.delayedCall(getSpawnInterval(), () => {
    if (gameStarted && !gameOver && !gamePaused) spawnObjects.call(this);
    if (typeof this.scheduleSpawn === "function") this.scheduleSpawn();
  }, []);
}

// ---- GAME EVENT HANDLERS ---- //
function handleStartGame() {
  sfx.uiClick.play();
  fadeIn(() => {
    if (userInfoEl) userInfoEl.style.display = 'none';
    if (viewLeaderboardBtn) viewLeaderboardBtn.style.display = 'none';
    if (startScreenEl) startScreenEl.style.display = 'none';
    if (muteBtnHome) muteBtnHome.style.display = 'none';
    gameStarted = true;
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.style.visibility = 'visible';
    if (scoreText) scoreText.setVisible(true);
    if (bestScoreText) bestScoreText.setVisible(true);
    if (pauseIcon) pauseIcon.setVisible(true);
    if (muteIcon) muteIcon.setVisible(true);
    this.scheduleSpawn();
    fadeOut();
  });
}
function handleGoHome() {
  fadeIn(() => {
    const scene = window.game.scene.keys.default;
    scene.scene.restart();
    score = 0;
    gameStarted = false;
    gameOver = false;
    gamePaused = false;
    if (gameOverScreenEl) gameOverScreenEl.style.display = 'none';
    if (userInfoEl) userInfoEl.style.display = 'flex';
    if (viewLeaderboardBtn) viewLeaderboardBtn.style.display = 'inline-block';
    if (startScreenEl) startScreenEl.style.display = 'flex';
    if (pauseOverlayEl) pauseOverlayEl.style.display = 'none';
    if (muteBtnHome) muteBtnHome.style.display = 'block';
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.style.visibility = 'hidden';
    fadeOut();
  });
}
function handlePlayAgain() {
  sfx.uiClick.play();
  const scene = window.game.scene.keys.default;
  if (scene.trail) {
    scene.trail.destroy();
    scene.trail = null;
  }
  scene.scene.restart();
  setTimeout(() => {
    score = 0;
    speed = 3;
    direction = 1;
    gameStarted = true;
    gameOver = false;
    gamePaused = false;
    ['game-over-screen', 'leaderboard-screen', 'pause-overlay', 'start-screen', 'leaderboard'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    if (muteBtnHome) muteBtnHome.style.display = 'none';
    if (userInfoEl) userInfoEl.style.display = 'none';
    if (viewLeaderboardBtn) viewLeaderboardBtn.style.display = 'none';
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.style.visibility = 'visible';
    if (scoreText) scoreText.setVisible(true);
    if (bestScoreText) bestScoreText.setVisible(true);
    if (pauseIcon) pauseIcon.setVisible(true);
    if (muteIcon) muteIcon.setVisible(true);
    if (spawnTimer) spawnTimer.remove(false);
    this.scheduleSpawn();
  }, 0);
}

// ---- UPDATE ---- //
function update() {
  if (!gameStarted || gameOver || gamePaused) return;
  angle += 0.05 * direction;
  const o1 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle).scale(radius);
  const o2 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle + Math.PI).scale(radius);
  circle1.setPosition(this.cameras.main.centerX + o1.x, this.cameras.main.centerY + o1.y);
  circle2.setPosition(this.cameras.main.centerX + o2.x, this.cameras.main.centerY + o2.y);
  obstacles.children.iterate(o => o.x -= speed);
  points.children.iterate(p => p.x -= speed);
}

// ---- OBJECT POOL SPAWN ---- //
function spawnObjects() {
  const y = Phaser.Math.RND.pick(LANES);
  const fromLeft = Phaser.Math.Between(0, 1) === 0;
  const x = fromLeft ? -50 : this.cameras.main.width + 50;
  const vx = (fromLeft ? speed : -speed) * 60;

  if (Phaser.Math.Between(1, 100) <= 35) {
    // Use pooled point & glow
    let glow = pointGlowPool.get(x, y, 'pointGlow');
    if (!glow) glow = this.add.image(x, y, 'pointGlow').setDepth(1).setBlendMode('ADD');
    else glow.setActive(true).setVisible(true).setDepth(1).setBlendMode('ADD').setPosition(x, y);
    let p = pointPool.get(x, y, 'point');
    if (!p) p = this.physics.add.image(x, y, 'point').setDepth(2);
    else {
      this.physics.add.existing(p);
      p.setActive(true).setVisible(true).setDepth(2).setPosition(x, y);
    }
    p.glow = glow;
    p.body.setSize(50, 50).setOffset(-25, -25).setVelocityX(vx);
    points.add(p);
  } else {
    // Use pooled obstacle
    let o = obstaclePool.get(x, y, 'obstacle');
    if (!o) o = this.physics.add.image(x, y, 'obstacle').setDepth(1);
    else {
      this.physics.add.existing(o);
      o.setActive(true).setVisible(true).setDepth(1).setPosition(x, y);
    }
    o.body.setSize(50, 50).setOffset(-25, -25).setImmovable(true).setVelocityX(vx);
    obstacles.add(o);
  }
}

// ---- GAME OVER ---- //
function triggerGameOver() {
  if (spawnTimer) spawnTimer.remove(false);
  if (gameOver) return;
  gameOver = true;
  [circle1, circle2].forEach(c => {
    const px = c.x, py = c.y; c.destroy();
    const emitter = this.add.particles('orb').createEmitter({
      x: px, y: py,
      speed: { min: 150, max: 350 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      lifespan: 500, blendMode: 'ADD', quantity: 8
    });
    this.time.delayedCall(1000, () => emitter.manager.destroy());
  });
  sfx.explode.play();
  this.time.delayedCall(700, () => {
    this.physics.pause();
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.style.visibility = 'hidden';
    if (finalScoreEl) finalScoreEl.innerText = score;
    if (score > highScore) {
      if (bestScoreText) bestScoreText.setText('Best: ' + score);
      highScore = score;
      sfx.newBest.play();
    }
    if (bestScoreEl) bestScoreEl.innerText = highScore;
    if (bestScoreText) bestScoreText.setText('Best: ' + highScore);
    if (useLocalHighScore) {
      localStorage.setItem('tricky_high_score', highScore);
      if (bestScoreText) bestScoreText.setText('Best: ' + highScore);
    }
    if (!useLocalHighScore) {
      fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: piUsername, score: highScore })
      }).catch(console.error);
    }
    fetch('/api/leaderboard?top=100')
      .then(r => r.json()).then(data => {
        if (leaderboardEntriesEl) {
          while (leaderboardEntriesEl.firstChild) leaderboardEntriesEl.removeChild(leaderboardEntriesEl.firstChild);
          data.forEach((e, i) => {
            const li = document.createElement('li');
            li.setAttribute('data-rank', `#${i + 1}`);
            li.innerHTML = `<strong>${e.username}</strong><strong>${e.score}</strong>`;
            leaderboardEntriesEl.appendChild(li);
          });
          if (leaderboardEl) leaderboardEl.style.display = 'block';
        }
        const rank = data.findIndex(e => e.username === piUsername);
        if (rankMessageEl) {
          if (rank >= 0) {
            rankMessageEl.innerText = `🏅 Your Global Rank: #${rank + 1}`;
          } else {
            rankMessageEl.innerText = `💡 You're currently unranked — keep playing!`;
          }
        }
        if (muteBtnHome) muteBtnHome.style.display = 'none';
        if (gameOverScreenEl) gameOverScreenEl.style.display = 'flex';
      }).catch(console.error);
  });
}

// ---- COLLECT POINT ---- //
function collectPoint(_, pt) {
  if (pt.glow) {
    pt.glow.setActive(false).setVisible(false);
    pointGlowPool.killAndHide(pt.glow);
    pt.glow = null;
  }
  pt.setActive(false).setVisible(false);
  pointPool.killAndHide(pt);
  score++;
  sfx.point.play();
  if (scoreText) scoreText.setText('Score: ' + score);
  this.tweens.add({
    targets: scoreText,
    scaleX: 1.1, scaleY: 1.1,
    yoyo: true, duration: 80, ease: 'Sine.easeOut'
  });
}

// ---- MUTE BUTTON ON HOME ---- //
if (muteBtnHome) {
  muteBtnHome.src = currentMuteIcon();
  muteBtnHome.addEventListener('click', () => {
    isMuted = !isMuted;
    if (window.muteIcon) window.muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
    muteBtnHome.src = currentMuteIcon();
    if (window.game && window.game.sound) {
      window.game.sound.mute = isMuted;
    }
  });
}
