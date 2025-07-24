// Tricky Turns game.js — PREFER POINTS OVER OBSTACLES (2024-07-23)

const muteBtnHome = document.getElementById('muteToggleHome');
let isLeaderboardLoading = false;
let spawnEvent = null;
let maxSpeed = 20;
let speed = 3;

const NUM_LANES = 3;
const SPAWN_BUFFER_X = 220;
const FORCED_SPAWN_INTERVAL = 1800;

let laneLastObstacleXs = [null, null, null];
let laneLastPointXs = [null, null, null];
let lastSpawnTimestamp = 0;

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

function onIncompletePaymentFound(payment) {
  console.log('Incomplete payment found:', payment);
}
async function initAuth() {
  await initPi();
  try {
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
    piUsername = auth.user.username;
    document.getElementById('username').innerText = piUsername;
    document.getElementById('loginBtn').style.display = 'none';
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
document.getElementById('loginBtn').addEventListener('click', initAuth);

function fadeInElement(el, duration = 500, displayType = 'flex') {
  el.style.opacity = 0;
  el.style.display = displayType;
  requestAnimationFrame(() => {
    el.style.transition = `opacity ${duration}ms ease`;
    el.style.opacity = 1;
  });
}
function fadeOutElement(el, duration = 500) {
  el.style.transition = `opacity ${duration}ms ease`;
  el.style.opacity = 0;
  setTimeout(() => {
    el.style.display = 'none';
  }, duration);
}
function fadeIn(callback, duration = 600) {
  const fade = document.getElementById('fade-screen');
  fade.classList.add('fade-in');
  setTimeout(() => {
    callback?.();
  }, duration);
}
function fadeOut(callback, duration = 600) {
  const fade = document.getElementById('fade-screen');
  fade.classList.remove('fade-in');
  setTimeout(() => {
    callback?.();
  }, duration);
}

async function showHomeLeaderboard() {
  if (isLeaderboardLoading) return;
  isLeaderboardLoading = true;
  const viewLeaderboardBtn = document.getElementById('viewLeaderboardBtn');
  if (viewLeaderboardBtn) viewLeaderboardBtn.disabled = true;
  const list = document.getElementById('leaderboardEntriesHome');
  while (list.firstChild) list.removeChild(list.firstChild);
  const loadingLi = document.createElement('li');
  loadingLi.textContent = 'Loading...';
  loadingLi.style.fontStyle = 'italic';
  loadingLi.style.textAlign = 'center';
  list.appendChild(loadingLi);
  try {
    const data = await fetch('/api/leaderboard?top=100').then(r => r.json());
    while (list.firstChild) list.removeChild(list.firstChild);
    data.forEach((e, i) => {
      const li = document.createElement('li');
      li.setAttribute('data-rank', `#${i + 1}`);
      li.innerHTML = `<strong>${e.username}</strong><strong>${e.score}</strong>`;
      list.appendChild(li);
    });
    document.getElementById('leaderboard-screen').style.display = 'flex';
  } catch (e) {
    while (list.firstChild) list.removeChild(list.firstChild);
    const errorLi = document.createElement('li');
    errorLi.textContent = 'Failed to load leaderboard.';
    errorLi.style.color = '#F66';
    errorLi.style.fontStyle = 'italic';
    errorLi.style.textAlign = 'center';
    list.appendChild(errorLi);
  } finally {
    isLeaderboardLoading = false;
    if (viewLeaderboardBtn) viewLeaderboardBtn.disabled = false;
  }
}

const LANES = [];
let gameStarted = false, gameOver = false, gamePaused = false;
let direction = 1, angle = 0, radius = 100;
let circle1, circle2, obstacles, points, score = 0;
let muteIcon, bestScoreText, scoreText, pauseIcon, pauseOverlay, countdownText;
let sfx = {}, isMuted = false;

const currentMuteIcon = () => isMuted ? 'assets/icon-unmute.svg' : 'assets/icon-mute.svg';
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

const config = {
  type: Phaser.AUTO,
  transparent: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: { key: 'default', preload, create, update }
};
window.game = new Phaser.Game(config);

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

function create() {
  const cam = this.cameras.main;
  const cx = cam.centerX, cy = cam.centerY;
  LANES[0] = cy - radius; LANES[1] = cy; LANES[2] = cy + radius;

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

  circle1 = this.add.image(0, 0, 'orb').setScale(1);
  this.physics.add.existing(circle1);
  circle1.body.setCircle(22.5, 27.5, 27.5);
  circle2 = this.add.image(0, 0, 'orb').setScale(1);
  this.physics.add.existing(circle2);
  circle2.body.setCircle(22.5, 27.5, 27.5);

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

  scoreText = this.add.text(16, 16, 'Score: 0', {
    fontFamily: 'Poppins', fontSize: '36px',
    color: '#fff', stroke: '#000', strokeThickness: 4
  }).setDepth(2).setVisible(false);
  bestScoreText = this.add.text(16, 64, 'Best: ' + highScore, {
    fontFamily: 'Poppins', fontSize: '28px',
    color: '#fff', stroke: '#000', strokeThickness: 3
  }).setDepth(2).setVisible(false);

  window.speedTestText = this.add.text(16, 100, 'Speed: 3.00', {
    fontFamily: 'Poppins', fontSize: '22px',
    color: '#eaeaea', stroke: '#222', strokeThickness: 2
  }).setDepth(2).setVisible(true);

  pauseIcon = this.add.image(cam.width - 40, 40, 'iconPause').setInteractive().setDepth(3).setVisible(false);
  muteIcon = this.add.image(cam.width - 100, 40, 'iconUnmute').setInteractive().setDepth(3).setVisible(false);
  window.muteIcon = muteIcon;
  this.sound.mute = isMuted;
  muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
  if (muteBtnHome) muteBtnHome.src = currentMuteIcon();
  pauseOverlay = document.getElementById('pause-overlay');

  countdownText = this.add.text(cx, cy, '', {
    fontFamily: 'Poppins', fontSize: '96px',
    color: '#fff', stroke: '#000', strokeThickness: 6
  }).setOrigin(0.5).setDepth(1000).setVisible(false);
  this.countdownText = countdownText;
  this.scoreText = scoreText;
  this.bestScoreText = bestScoreText;
  this.pauseIcon = pauseIcon;
  this.muteIcon = muteIcon;

  this.startCountdown = function(callback) {
    let count = 3;
    this.countdownText.setText(count).setVisible(true);
    this.countdownText.setDepth(1000);
    const countdownEvent = this.time.addEvent({
      delay: 1000,
      repeat: 3,
      callback: () => {
        count--;
        if (count > 0) {
          this.countdownText.setText(count);
        } else if (count === 0) {
          this.countdownText.setText('Go!');
        } else {
          this.countdownText.setVisible(false);
          countdownEvent.remove(false);
          if (typeof callback === "function") callback.call(this);
        }
      }
    });
  };

  // Fast acceleration
  this.time.addEvent({
    delay: 1000, loop: true,
    callback: () => {
      if (gameStarted && !gameOver && !gamePaused) {
        if (score < 20)        speed = Math.min(speed + 0.025, maxSpeed);
        else if (score < 50)   speed = Math.min(speed + 0.045, maxSpeed);
        else                   speed = Math.min(speed + 0.07,  maxSpeed);
      }
      if (window.speedTestText) window.speedTestText.setText('Speed: ' + speed.toFixed(2));
    }
  });

  function getSpawnInterval() {
    const minDelay = 350, maxDelay = 1100, baseSpeed = 3;
    let t = Math.min((speed - baseSpeed) / (maxSpeed - baseSpeed), 1);
    let interval = Math.max(maxDelay - (maxDelay - minDelay) * t, minDelay);
    return interval + Phaser.Math.Between(-50, 50);
  }

  if (spawnEvent) spawnEvent.remove(false);
  spawnEvent = this.time.addEvent({
    delay: getSpawnInterval(),
    loop: true,
    callback: () => {
      if (gameStarted && !gameOver && !gamePaused) {
        spawnObjects.call(this);
        lastSpawnTimestamp = this.time.now;
      }
      spawnEvent.delay = getSpawnInterval();
    }
  });

  this.time.addEvent({
    delay: 250,
    loop: true,
    callback: () => {
      if (!gameStarted || gameOver || gamePaused) return;
      if (this.time.now - lastSpawnTimestamp > FORCED_SPAWN_INTERVAL) {
        spawnObjects.call(this);
        lastSpawnTimestamp = this.time.now;
      }
    }
  });

  sfx.explode = this.sound.add('explode');
  sfx.move = this.sound.add('move');
  sfx.point = this.sound.add('point');
  sfx.newBest = this.sound.add('newBest');
  sfx.uiClick = this.sound.add('uiClick');
  sfx.pauseWhoosh = this.sound.add('pauseWhoosh');

  muteIcon.on('pointerdown', () => {
    isMuted = !isMuted;
    this.sound.mute = isMuted;
    muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
    if (muteBtnHome) muteBtnHome.src = currentMuteIcon();
    if (!isMuted) sfx.uiClick.play();
  });

  pauseIcon.on('pointerdown', (_, x, y, e) => {
    e.stopPropagation();
    if (!gameStarted || gameOver) return;
    if (!gamePaused) {
      gamePaused = true;
      pauseIcon.setTexture('iconPlay');
      sfx.pauseWhoosh.play();
      this.physics.pause();
      pauseOverlay.style.display = 'flex';
    } else {
      sfx.pauseWhoosh.play();
      pauseOverlay.style.display = 'none';
      let count = 3;
      countdownText.setText(count).setVisible(true).setDepth(1000);
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

  this.physics.add.overlap(circle1, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle2, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle1, points, collectPoint, null, this);
  this.physics.add.overlap(circle2, points, collectPoint, null, this);
}

function update() {
  if (gameOver) return;
  let ANGULAR_BASE = 0.05;
  let ANGULAR_SCALE = 0.005;
  let dt = (gameStarted && !gamePaused)
    ? (ANGULAR_BASE + ANGULAR_SCALE * (speed - 3)) * direction
    : 0;

  angle += dt;
  const o1 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle).scale(radius);
  const o2 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle + Math.PI).scale(radius);

  circle1.setPosition(this.cameras.main.centerX + o1.x, this.cameras.main.centerY + o1.y);
  circle2.setPosition(this.cameras.main.centerX + o2.x, this.cameras.main.centerY + o2.y);

  if (gameStarted && !gamePaused) {
    obstacles.children.iterate((o) => {
      if (o) {
        o.x -= speed;
        if (o.x < -100 || o.x > this.cameras.main.width + 100) {
          for (let i = 0; i < NUM_LANES; i++) {
            if (Math.abs(o.y - LANES[i]) < 1e-2) {
              laneLastObstacleXs[i] = null;
              break;
            }
          }
          o.destroy();
        }
      }
    });
    points.children.iterate((p) => {
      if (p) {
        p.x -= speed;
        if (p.x < -100 || p.x > this.cameras.main.width + 100) {
          for (let i = 0; i < NUM_LANES; i++) {
            if (Math.abs(p.y - LANES[i]) < 1e-2) {
              laneLastPointXs[i] = null;
              break;
            }
          }
          p.destroy();
        }
      }
    });
  }
}

// -- KEY PATCH: Points spawn before obstacles --
function spawnObjects() {
  const scene = window.game.scene.keys.default;
  const camWidth = scene.cameras.main.width;
  const fromLeft = Phaser.Math.Between(0, 1) === 0;
  const x = fromLeft ? -50 : camWidth + 50;
  const vx = (fromLeft ? speed : -speed) * 60;

  let pointChance = 70; // For maximum points under 20
  if (score >= 20) pointChance = 50;
  if (score >= 50) pointChance = 35;

  // Figure out safe lanes for obstacles and points
  let safeObstacleLanes = [];
  let safePointLanes = [];
  for (let lane = 0; lane < NUM_LANES; lane++) {
    // Safe for obstacle: no obstacles (including adjacent) close by
    let obsSafe = true;
    for (let adj = -1; adj <= 1; adj++) {
      let checkLane = lane + adj;
      if (checkLane < 0 || checkLane >= NUM_LANES) continue;
      let lastX = laneLastObstacleXs[checkLane];
      if (lastX !== null && Math.abs(lastX - x) < SPAWN_BUFFER_X) {
        obsSafe = false;
        break;
      }
    }
    if (obsSafe) safeObstacleLanes.push(lane);

    // Safe for point: no obstacle (including adjacent) close by
    let ptSafe = true;
    for (let adj = -1; adj <= 1; adj++) {
      let checkLane = lane + adj;
      if (checkLane < 0 || checkLane >= NUM_LANES) continue;
      let lastObsX = laneLastObstacleXs[checkLane];
      if (lastObsX !== null && Math.abs(lastObsX - x) < SPAWN_BUFFER_X) {
        ptSafe = false;
        break;
      }
    }
    if (ptSafe) safePointLanes.push(lane);
  }

  // -- Points first: Spawn one point if possible and allowed by chance
  let spawnedPointLane = null;
  if (safePointLanes.length > 0 && Phaser.Math.Between(1, 100) <= pointChance) {
    const pointLaneIdx = Phaser.Utils.Array.GetRandom(safePointLanes);
    const pointLane = LANES[pointLaneIdx];
    const glow = scene.add.image(x, pointLane, 'pointGlow').setDepth(1).setBlendMode('ADD');
    const p = scene.physics.add.image(x, pointLane, 'point').setDepth(2);
    p.glow = glow;
    p.body.setSize(50, 50).setOffset(-25, -25).setVelocityX(vx);
    points.add(p);
    laneLastPointXs[pointLaneIdx] = x;
    spawnedPointLane = pointLaneIdx;
  }

  // -- Obstacles: spawn only in lanes where we didn't just spawn a point
  if (safeObstacleLanes.length > 0) {
    // Remove lane used for point from obstacle candidates
    let obstacleCandidates = spawnedPointLane !== null
      ? safeObstacleLanes.filter(lane => lane !== spawnedPointLane)
      : safeObstacleLanes;

    if (obstacleCandidates.length > 0) {
      const chosenLaneIdx = Phaser.Utils.Array.GetRandom(obstacleCandidates);
      const laneY = LANES[chosenLaneIdx];
      const o = scene.physics.add.image(x, laneY, 'obstacle').setDepth(1);
      o.body.setSize(50, 50).setOffset(-25, -25).setImmovable(true).setVelocityX(vx);
      obstacles.add(o);
      laneLastObstacleXs[chosenLaneIdx] = x;
    }
  }

  lastSpawnTimestamp = window.game.scene.keys.default.time.now;
}

function triggerGameOver() {
  if (spawnEvent) spawnEvent.remove(false);
  if (gameOver) return;
  gameOver = true;

  [circle1, circle2].forEach(c => {
    const px = c.x, py = c.y; c.destroy();
    const emitter = window.game.scene.keys.default.add.particles('orb').createEmitter({
      x: px, y: py,
      speed: { min: 150, max: 350 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      lifespan: 500, blendMode: 'ADD', quantity: 8
    });
    window.game.scene.keys.default.time.delayedCall(1000, () => emitter.manager.destroy());
  });
  sfx.explode.play();

  window.game.scene.keys.default.time.delayedCall(700, () => {
    window.game.scene.keys.default.physics.pause();
    document.querySelector('canvas').style.visibility = 'hidden';
    document.getElementById('finalScore').innerText = score;
    if (score > highScore) {
      bestScoreText.setText('Best: ' + score);
      highScore = score;
      sfx.newBest.play();
    }
    document.getElementById('bestScore').innerText = highScore;
    bestScoreText.setText('Best: ' + highScore);
    if (useLocalHighScore) {
      localStorage.setItem('tricky_high_score', highScore);
      if (typeof bestScoreText !== 'undefined') bestScoreText.setText('Best: ' + highScore);
    }

    if (muteBtnHome) muteBtnHome.style.display = 'none';
    document.getElementById('game-over-screen').style.display = 'flex';

    const list = document.getElementById('leaderboardEntries');
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      const loadingLi = document.createElement('li');
      loadingLi.textContent = 'Loading leaderboard...';
      loadingLi.style.fontStyle = 'italic';
      loadingLi.style.textAlign = 'center';
      list.appendChild(loadingLi);
    }
    const rankMessage = document.getElementById('rankMessage');
    if (rankMessage) rankMessage.innerText = "";

    (async () => {
      if (!useLocalHighScore) {
        try {
          await fetch('/api/leaderboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: piUsername, score: highScore })
          });
        } catch (e) { /* ignore */ }
      }
      try {
        const data = await fetch('/api/leaderboard?top=100').then(r => r.json());
        if (list) {
          while (list.firstChild) list.removeChild(list.firstChild);
          data.forEach((e, i) => {
            const li = document.createElement('li');
            li.setAttribute('data-rank', `#${i + 1}`);
            li.innerHTML = `<strong>${e.username}</strong><strong>${e.score}</strong>`;
            list.appendChild(li);
          });
        }
        const rank = data.findIndex(e => e.username === piUsername);
        if (rankMessage) {
          if (rank >= 0) {
            rankMessage.innerText = `🏅 Your Global Rank: #${rank + 1}`;
          } else {
            rankMessage.innerText = `💡 You're currently unranked — keep playing!`;
          }
        }
      } catch (e) {
        if (list) {
          while (list.firstChild) list.removeChild(list.firstChild);
          const errorLi = document.createElement('li');
          errorLi.textContent = 'Failed to load leaderboard.';
          errorLi.style.color = '#F66';
          errorLi.style.fontStyle = 'italic';
          errorLi.style.textAlign = 'center';
          list.appendChild(errorLi);
        }
        if (rankMessage) rankMessage.innerText = '';
      }
    })();
  });
}

function collectPoint(_, pt) {
  if (pt.glow) pt.glow.destroy();
  pt.destroy();
  score++;
  sfx.point.play();
  scoreText.setText('Score: ' + score);
  window.game.scene.keys.default.tweens.add({
    targets: scoreText,
    scaleX: 1.1, scaleY: 1.1,
    yoyo: true, duration: 80, ease: 'Sine.easeOut'
  });
}

function handleStartGame() {
  sfx.uiClick.play();
  document.getElementById('user-info').style.display = 'none';
  document.getElementById('viewLeaderboardBtn').style.display = 'none';
  document.getElementById('start-screen').style.display = 'none';
  if (muteBtnHome) muteBtnHome.style.display = 'none';
  document.querySelector('canvas').style.visibility = 'visible';
  fadeOut(() => {
    const scene = window.game.scene.keys.default;
    scene.scoreText.setVisible(true);
    scene.bestScoreText.setVisible(true);
    scene.pauseIcon.setVisible(true);
    scene.muteIcon.setVisible(true);
    scene.startCountdown(function() {
      gameStarted = true;
      scene.scheduleSpawn ? scene.scheduleSpawn() : null;
    });
  }, 200);
}

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
    laneLastObstacleXs = [null, null, null];
    laneLastPointXs = [null, null, null];
    lastSpawnTimestamp = 0;
    document.getElementById('game-over-screen').style.display = 'none';
    document.getElementById('user-info').style.display = 'flex';
    document.getElementById('viewLeaderboardBtn').style.display = 'inline-block';
    document.getElementById('start-screen').style.display = 'flex';
    document.getElementById('pause-overlay').style.display = 'none';
    if (muteBtnHome) muteBtnHome.style.display = 'block';
    document.querySelector('canvas').style.visibility = 'hidden';
    fadeOut();
  });
}

function handlePlayAgain() {
  sfx.uiClick.play();
  const scene = window.game.scene.keys.default;
  if (scene.trail) { scene.trail.destroy(); scene.trail = null; }
  if (spawnEvent) spawnEvent.remove(false);
  scene.scene.restart();
  setTimeout(() => {
    score = 0;
    speed = 3;
    direction = 1;
    gameStarted = false;
    gameOver = false;
    gamePaused = false;
    laneLastObstacleXs = [null, null, null];
    laneLastPointXs = [null, null, null];
    lastSpawnTimestamp = 0;
    [
      'game-over-screen', 'leaderboard-screen', 'pause-overlay',
      'start-screen', 'leaderboard'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    if (muteBtnHome) muteBtnHome.style.display = 'none';
    const userInfo = document.getElementById('user-info');
    if (userInfo) userInfo.style.display = 'none';
    const viewLb = document.getElementById('viewLeaderboardBtn');
    if (viewLb) viewLb.style.display = 'none';
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.style.visibility = 'visible';
    const scene = window.game.scene.keys.default;
    scene.scoreText.setVisible(true);
    scene.bestScoreText.setVisible(true);
    scene.pauseIcon.setVisible(true);
    scene.muteIcon.setVisible(true);
    scene.startCountdown(function() {
      gameStarted = true;
      scene.scheduleSpawn ? scene.scheduleSpawn() : null;
    });
  }, 0);
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('startBtn').onclick = handleStartGame;
  document.getElementById('homeBtn').onclick = handleGoHome;
  document.getElementById('viewLeaderboardBtn').addEventListener('click', showHomeLeaderboard);
  document.getElementById('closeLeaderboardBtn').addEventListener('click', () => {
    document.getElementById('leaderboard-screen').style.display = 'none';
  });
  const playAgainBtn = document.getElementById('playAgainBtn');
  if (playAgainBtn) playAgainBtn.onclick = handlePlayAgain;
});
