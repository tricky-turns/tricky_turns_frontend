// --- Core Game State & Config (declare before anything else) ---
let isMuted = false; // <-- MUST be first!
const LANES = [];
let gameStarted = false, gameOver = false, gamePaused = false;
let direction = 1, angle = 0, radius = 100, speed = 3, maxSpeed = 6;
let circle1, circle2, obstacles, points, score = 0;
let muteIcon;
let bestScoreText;
let scoreText, pauseIcon, countdownText;
let spawnTimer;
let sfx = {};

// --- Utility: DOM Access Helpers ---
function $(id) { return document.getElementById(id); }
function $qs(selector) { return document.querySelector(selector); }

// --- Cache important DOM elements ---
const muteBtnHome = $('muteToggleHome');
const usernameElem = $('username');
const loginBtn = $('loginBtn');
const userInfo = $('user-info');
const viewLeaderboardBtn = $('viewLeaderboardBtn');
const startScreen = $('start-screen');
const fadeScreen = $('fade-screen');
const pauseOverlay = $('pause-overlay');
const startBtn = $('startBtn');
const homeBtn = $('homeBtn');
const playAgainBtn = $('playAgainBtn');
const gameOverScreen = $('game-over-screen');
const leaderboardEntriesHome = $('leaderboardEntriesHome');
const leaderboardScreen = $('leaderboard-screen');
const leaderboardEntries = $('leaderboardEntries');
const leaderboardDiv = $('leaderboard');
const rankMessage = $('rankMessage');
const finalScoreElem = $('finalScore');
const bestScoreElem = $('bestScore');

// --- Pi SDK Initialization ---
let piInitPromise = null;
function initPi() {
  if (!piInitPromise) piInitPromise = Pi.init({ version: "2.0", sandbox: true });
  return piInitPromise;
}

// --- Pi Authentication setup ---
const scopes = ['username'];
let piUsername = 'Guest';
let highScore = 0;
let useLocalHighScore = true;

function onIncompletePaymentFound(payment) {
  console.log('Incomplete payment found:', payment);
}

async function initAuth() {
  await initPi();
  try {
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
    piUsername = auth.user.username;
    if (usernameElem) usernameElem.textContent = piUsername;
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
    console.error('Not signed in:', e);
  }
}

// --- Utility: Fade In/Out helpers ---
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
  setTimeout(() => { el.style.display = 'none'; }, duration);
}

function fadeIn(callback, duration = 600) {
  if (fadeScreen) fadeScreen.classList.add('fade-in');
  setTimeout(() => { callback?.(); }, duration);
}

function fadeOut(callback, duration = 600) {
  if (fadeScreen) fadeScreen.classList.remove('fade-in');
  setTimeout(() => { callback?.(); }, duration);
}

// --- Utility: Mute State Handler ---
function currentMuteIcon() { return isMuted ? 'assets/icon-unmute.svg' : 'assets/icon-mute.svg'; }
function setMuteState(muted) {
  isMuted = muted;
  if (window.muteIcon) window.muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
  if (muteBtnHome) muteBtnHome.src = currentMuteIcon();
  if (window.game && window.game.sound) window.game.sound.mute = isMuted;
}

// --- Show Home Leaderboard ---
async function showHomeLeaderboard() {
  if (!leaderboardEntriesHome) return;
  while (leaderboardEntriesHome.firstChild) leaderboardEntriesHome.removeChild(leaderboardEntriesHome.firstChild);
  try {
    const data = await fetch('/api/leaderboard?top=100').then(r => r.json());
    data.forEach((e, i) => {
      const li = document.createElement('li');
      li.setAttribute('data-rank', `#${i + 1}`);
      // Use textContent to avoid injection
      const userSpan = document.createElement('strong');
      userSpan.textContent = e.username;
      const scoreSpan = document.createElement('strong');
      scoreSpan.textContent = e.score;
      li.appendChild(userSpan);
      li.appendChild(scoreSpan);
      leaderboardEntriesHome.appendChild(li);
    });
    if (leaderboardScreen) leaderboardScreen.style.display = 'flex';
  } catch (e) {
    alert('Failed to load leaderboard. Please try again later.');
    console.error(e);
  }
}

// --- Mute button setup ---
if (muteBtnHome) {
  muteBtnHome.src = currentMuteIcon();
  muteBtnHome.onclick = () => setMuteState(!isMuted);
}

// --- Login button setup ---
if (loginBtn) loginBtn.onclick = initAuth;

// --- Leaderboard buttons setup ---
if (viewLeaderboardBtn) viewLeaderboardBtn.onclick = showHomeLeaderboard;
$('closeLeaderboardBtn')?.addEventListener('click', () => {
  if (leaderboardScreen) leaderboardScreen.style.display = 'none';
});

// --- Phaser & Game State ---
window.game = new Phaser.Game({
  type: Phaser.AUTO,
  transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: { key: 'default', preload, create, update }
});

// --- Phaser Scene: Preload ---
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

// --- Phaser Scene: Create ---
function create() {
  const cam = this.cameras.main;
  const cx = cam.centerX, cy = cam.centerY;
  LANES[0] = cy - radius; LANES[1] = cy; LANES[2] = cy + radius;

  // Clean up previous textures
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

  // Orbit sprites
  circle1 = this.add.image(0, 0, 'orb'); this.physics.add.existing(circle1);
  circle1.body.setCircle(22.5, 27.5, 27.5);
  circle2 = this.add.image(0, 0, 'orb'); this.physics.add.existing(circle2);
  circle2.body.setCircle(22.5, 27.5, 27.5);

  // Trail
  if (this.trail) { this.trail.destroy(); this.trail = null; }
  this.trail = this.add.particles('orb');
  [circle1, circle2].forEach(c => this.trail.createEmitter({
    follow: c, lifespan: 300, speed: 0,
    scale: { start: 0.3, end: 0 }, alpha: { start: 0.4, end: 0 },
    frequency: 50, blendMode: 'ADD'
  }));
  this.events.on('shutdown', () => { if (this.trail) { this.trail.destroy(); this.trail = null; } });

  obstacles = this.physics.add.group();
  points = this.physics.add.group();

  // HUD
  scoreText = this.add.text(16, 16, 'Score: 0', {
    fontFamily: 'Poppins', fontSize: '36px',
    color: '#fff', stroke: '#000', strokeThickness: 4
  }).setDepth(2).setVisible(false);

  bestScoreText = this.add.text(16, 64, 'Best: ' + highScore, {
    fontFamily: 'Poppins', fontSize: '28px',
    color: '#fff', stroke: '#000', strokeThickness: 3
  }).setDepth(2).setVisible(false);

  // Initialize highScore from localStorage if using guest
  if (useLocalHighScore) {
    highScore = Number(localStorage.getItem('tricky_high_score')) || 0;
    bestScoreText.setText('Best: ' + highScore);
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

  // SFX map
  const sfxNames = ['explode', 'move', 'point', 'newBest', 'uiClick', 'pauseWhoosh'];
  sfx = {};
  sfxNames.forEach(name => { sfx[name] = this.sound.add(name); });

  // --- Mute toggle ---
  muteIcon.on('pointerdown', () => {
    setMuteState(!isMuted);
    if (!isMuted) sfx.uiClick.play();
  });

  // --- Pause/play toggle ---
  pauseIcon.on('pointerdown', (_, x, y, e) => {
    e?.stopPropagation?.();
    if (!gameStarted || gameOver) return;
    if (!gamePaused) {
      gamePaused = true;
      pauseIcon.setTexture('iconPlay');
      sfx.pauseWhoosh.play();
      if (pauseOverlay) pauseOverlay.style.display = 'flex';
      this.physics.pause();
    } else {
      sfx.pauseWhoosh.play();
      if (pauseOverlay) pauseOverlay.style.display = 'none';
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

  // --- Rotate on tap ---
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

  // --- Collisions ---
  this.physics.add.overlap(circle1, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle2, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle1, points, collectPoint, null, this);
  this.physics.add.overlap(circle2, points, collectPoint, null, this);

  // --- Speed ramp ---
  this.time.addEvent({
    delay: 1000, loop: true,
    callback: () => {
      if (gameStarted && !gameOver && !gamePaused) {
        if (speed > 1.5) speed += 0.006;
        else if (speed >= 1.2) speed += 0.0015;
      }
    }
  });

  // --- Spawn scheduler ---
  function getSpawnInterval() {
    const t = Phaser.Math.Clamp((speed - 3) / (maxSpeed - 3), 0, 1);
    return Phaser.Math.Linear(1500, 500, t);
  }
  function scheduleSpawn() {
    const scene = window.game.scene.keys.default;
    spawnTimer = scene.time.delayedCall(getSpawnInterval(), () => {
      if (gameStarted && !gameOver && !gamePaused) spawnObjects.call(scene);
      scheduleSpawn();
    }, []);
  }

  // --- START BUTTON ---
  function handleStartGame() {
  sfx.uiClick.play();
  fadeIn(() => {
    document.getElementById('user-info').style.display = 'none';
    document.getElementById('viewLeaderboardBtn').style.display = 'none';
    document.getElementById('start-screen').style.display = 'none';
    muteBtnHome.style.display = 'none';
    if (document.querySelector('canvas')) document.querySelector('canvas').style.visibility = 'visible';
    scoreText.setVisible(false);
    bestScoreText.setVisible(false);
    pauseIcon.setVisible(false);
    muteIcon.setVisible(false);
    let count = 3;
    countdownText.setText(count).setVisible(true);
    const scene = window.game.scene.keys.default;
    scene.time.addEvent({
      delay: 1000,
      repeat: 2,
      callback: () => {
        count--;
        if (count > 0) {
          countdownText.setText(count);
        } else if (count === 0) {
          countdownText.setText('GO!');
        }
      },
      callbackScope: scene,
      onComplete: () => {
        setTimeout(() => {
          countdownText.setVisible(false);
          gameStarted = true;
          scoreText.setVisible(true);
          bestScoreText.setVisible(true);
          pauseIcon.setVisible(true);
          muteIcon.setVisible(true);
          scheduleSpawn();
          fadeOut();
        }, 500);
      }
    });
  });
}
    sfx.uiClick.play();
    fadeIn(() => {
      if (userInfo) userInfo.style.display = 'none';
      if (viewLeaderboardBtn) viewLeaderboardBtn.style.display = 'none';
      if (startScreen) startScreen.style.display = 'none';
      if (muteBtnHome) muteBtnHome.style.display = 'none';
      gameStarted = true;
      if ($qs('canvas')) $qs('canvas').style.visibility = 'visible';
      scoreText.setVisible(true);
      bestScoreText.setVisible(true);
      pauseIcon.setVisible(true);
      muteIcon.setVisible(true);
      scheduleSpawn();
      fadeOut();
    });
  }

  // --- HOME BUTTON ---
  function handleGoHome() {
    fadeIn(() => {
      const scene = window.game.scene.keys.default;
      scene.scene.restart();
      score = 0;
      speed = 3;
      direction = 1;
      gameStarted = false;
      gameOver = false;
      gamePaused = false;
      if (gameOverScreen) gameOverScreen.style.display = 'none';
      if (userInfo) userInfo.style.display = 'flex';
      if (viewLeaderboardBtn) viewLeaderboardBtn.style.display = 'inline-block';
      if (startScreen) startScreen.style.display = 'flex';
      if (pauseOverlay) pauseOverlay.style.display = 'none';
      if (muteBtnHome) muteBtnHome.style.display = 'block';
      if ($qs('canvas')) $qs('canvas').style.visibility = 'hidden';
      fadeOut();
    });
  }

  // --- PLAY AGAIN BUTTON ---
  function handlePlayAgain() {
    sfx.uiClick.play();
    const scene = window.game.scene.keys.default;
    if (scene.trail) { scene.trail.destroy(); scene.trail = null; }
    scene.scene.restart();
    setTimeout(() => {
      score = 0;
      speed = 3;
      direction = 1;
      gameStarted = true;
      gameOver = false;
      gamePaused = false;
      ['game-over-screen', 'leaderboard-screen', 'pause-overlay', 'start-screen', 'leaderboard']
        .forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      if (muteBtnHome) muteBtnHome.style.display = 'none';
      if (userInfo) userInfo.style.display = 'none';
      if (viewLeaderboardBtn) viewLeaderboardBtn.style.display = 'none';
      if ($qs('canvas')) $qs('canvas').style.visibility = 'visible';
      scoreText.setVisible(true);
      bestScoreText.setVisible(true);
      pauseIcon.setVisible(true);
      muteIcon.setVisible(true);
      if (spawnTimer) spawnTimer.remove(false);
      scheduleSpawn();
    }, 0);
  }

  // --- Bind UI Buttons ---
  if (startBtn) startBtn.onclick = handleStartGame;
  if (homeBtn) homeBtn.onclick = handleGoHome;
  if (playAgainBtn) playAgainBtn.onclick = handlePlayAgain;
}

// --- Phaser Scene: Update ---
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

// --- Spawn Objects ---
function spawnObjects() {
  const y = Phaser.Math.RND.pick(LANES);
  const fromLeft = Phaser.Math.Between(0, 1) === 0;
  const x = fromLeft ? -50 : this.cameras.main.width + 50;
  const vx = (fromLeft ? speed : -speed) * 60;
  if (Phaser.Math.Between(1, 100) <= 35) {
    const glow = this.add.image(x, y, 'pointGlow').setDepth(1).setBlendMode('ADD');
    const p = this.physics.add.image(x, y, 'point').setDepth(2);
    p.glow = glow;
    p.body.setSize(50, 50).setOffset(-25, -25).setVelocityX(vx);
    points.add(p);
  } else {
    const o = this.physics.add.image(x, y, 'obstacle').setDepth(1);
    o.body.setSize(50, 50).setOffset(-25, -25).setImmovable(true).setVelocityX(vx);
    obstacles.add(o);
  }
}

// --- Game Over Logic ---
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
  this.time.delayedCall(700, async () => {
    this.physics.pause();
    if ($qs('canvas')) $qs('canvas').style.visibility = 'hidden';
    if (finalScoreElem) finalScoreElem.textContent = score;
    if (score > highScore) {
      highScore = score; // Set score first!
      bestScoreText.setText('Best: ' + highScore);
      sfx.newBest.play();
    }
    if (bestScoreElem) bestScoreElem.textContent = highScore;
    bestScoreText.setText('Best: ' + highScore);
    if (useLocalHighScore) {
      localStorage.setItem('tricky_high_score', highScore);
      bestScoreText.setText('Best: ' + highScore);
    }
    if (!useLocalHighScore) {
      try {
        await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: piUsername, score: highScore })
        });
      } catch (e) { console.error('Failed to submit score:', e); }
    }
    try {
      const data = await fetch('/api/leaderboard?top=100').then(r => r.json());
      if (leaderboardEntries) {
        while (leaderboardEntries.firstChild) leaderboardEntries.removeChild(leaderboardEntries.firstChild);
        data.forEach((e, i) => {
          const li = document.createElement('li');
          li.setAttribute('data-rank', `#${i + 1}`);
          // Securely inject username and score
          const userSpan = document.createElement('strong');
          userSpan.textContent = e.username;
          const scoreSpan = document.createElement('strong');
          scoreSpan.textContent = e.score;
          li.appendChild(userSpan);
          li.appendChild(scoreSpan);
          leaderboardEntries.appendChild(li);
        });
        if (leaderboardDiv) leaderboardDiv.style.display = 'block';
      }
      const rank = data.findIndex(e => e.username === piUsername);
      if (rankMessage) {
        rankMessage.textContent = rank >= 0
          ? `🏅 Your Global Rank: #${rank + 1}`
          : `💡 You're currently unranked — keep playing!`;
      }
      if (muteBtnHome) muteBtnHome.style.display = 'none';
      if (gameOverScreen) gameOverScreen.style.display = 'flex';
    } catch (e) {
      alert('Failed to load leaderboard. Please try again later.');
      console.error(e);
    }
  });
}

// --- Collect Point Logic ---
function collectPoint(_, pt) {
  if (pt.glow) pt.glow.destroy();
  pt.destroy();
  score++;
  sfx.point.play();
  scoreText.setText('Score: ' + score);
  this.tweens.add({
    targets: scoreText,
    scaleX: 1.1, scaleY: 1.1,
    yoyo: true, duration: 80, ease: 'Sine.easeOut'
  });
}

// --- Initialize Auth (on load) ---
initAuth();