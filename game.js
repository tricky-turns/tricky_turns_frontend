// PATCHED GAME.JS — 2024-07-23

const muteBtnHome = document.getElementById('muteToggleHome');
let isLeaderboardLoading = false;

// Initialize Pi SDK (with sandbox for local dev)
let piInitPromise = null;
function initPi() {
  if (!piInitPromise) {
    piInitPromise = Pi.init({ version: "2.0", sandbox: true });
  }
  return piInitPromise;
}

// —— Pi Authentication setup ——
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
      const data = await res.json();
      highScore = data.highScore;
      localStorage.setItem('tt_highScore', highScore);
    }
  } catch (e) {
    console.warn('Pi Auth failed, playing as Guest', e);
  }
}

// —— Fade helpers ——
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
    fade.classList.remove('fade-in');
    callback();
  }, duration);
}

// —— Phaser Game Config ——
let gameStarted = false, gameOver = false, gamePaused = false;
let circle1, circle2, obstacles, points;
let spawnTimer;

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  scene: {
    preload,
    create,
    update
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  }
};

new Phaser.Game(config);

// —— Preload Assets ——
function preload() {
  this.load.image('orb', 'assets/orb.png');
  this.load.image('obstacle', 'assets/obstacle.png');
  this.load.image('point', 'assets/point.png');
  this.load.audio('pointSfx', 'assets/point.mp3');
  this.load.audio('hitSfx', 'assets/hit.mp3');
  this.load.audio('uiClick', 'assets/uiClick.mp3');
  this.load.audio('pauseWhoosh', 'assets/pauseWhoosh.mp3');
  // Add background music if desired:
  // this.load.audio('bgMusic', 'assets/bgMusic.mp3');
}

// —— Create Scene ——
function create() {
  // Orbs & state
  let direction = 1, angle = 0;
  const radius = 100, maxSpeed = 25;
  let speed = 3;

  // Setup groups
  obstacles = this.physics.add.group();
  points = this.physics.add.group();

  // UI audio
  const uiClick = this.sound.add('uiClick');
  const pauseWhoosh = this.sound.add('pauseWhoosh');

  // Phaser-based tutorial overlay (first-run)
  if (!localStorage.getItem('tt_seenTutorial')) {
    // ... implement tutorial overlay here ...
    localStorage.setItem('tt_seenTutorial', '1');
  }

  // Speed ramp: clamp to maxSpeed
  this.time.addEvent({
    delay: 1000,
    loop: true,
    callback: () => {
      if (gameStarted && !gameOver && !gamePaused) {
        if (speed > 1.5) {
          speed = Math.min(speed + 0.006, maxSpeed);
        } else if (speed >= 1.2) {
          speed = Math.min(speed + 0.0015, maxSpeed);
        }
      }
    }
  });

  // Helper for dynamic spawn interval
  function getSpawnInterval() {
    const t = Phaser.Math.Clamp((speed - 3) / (maxSpeed - 3), 0, 1);
    return Phaser.Math.Linear(1500, 500, t);
  }

  // --- Helper to schedule spawn using Phaser's looping timed event ---
  this.scheduleSpawn = function() {
    // Remove existing timer if present
    if (spawnTimer) {
      spawnTimer.remove(false);
    }
    // Create a looping event that spawns objects and updates delay dynamically
    spawnTimer = this.time.addEvent({
      delay: getSpawnInterval(),
      callback: function() {
        if (gameStarted && !gameOver && !gamePaused) {
          spawnObjects.call(this);
        }
        // Adjust delay for next spawn based on current speed
        spawnTimer.delay = getSpawnInterval();
      },
      callbackScope: this,
      loop: true
    });
  };

  // Start Countdown & Spawn after DOM ready
  this.time.delayedCall(0, () => {
    this.startCountdown(function() {
      gameStarted = true;
      this.scheduleSpawn();
    }, this);
  }, [], this);

  // Input handlers
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('startBtn').onclick = () => {
      uiClick.play();
      fadeOutElement(document.getElementById('start-screen'));
      fadeIn(() => fadeOutElement(document.getElementById('fade-screen')));
    };
    document.getElementById('pauseBtn').onclick = () => {
      uiClick.play();
      gamePaused = !gamePaused;
      pauseWhoosh.play();
      document.getElementById('pause-overlay').style.display = gamePaused ? 'block' : 'none';
    };
    muteBtnHome.src = localStorage.getItem('tt_muted') === '1' ? 'icons/mute-on.svg' : 'icons/mute-off.svg';
    muteBtnHome.onclick = () => {
      uiClick.play();
      const muted = localStorage.getItem('tt_muted') === '1';
      localStorage.setItem('tt_muted', muted ? '0' : '1');
      muteBtnHome.src = muted ? 'icons/mute-off.svg' : 'icons/mute-on.svg';
      this.sound.mute = !this.sound.mute;
    };
    document.getElementById('viewLeaderboardBtn').onclick = async () => {
      if (isLeaderboardLoading) return;
      isLeaderboardLoading = true;
      uiClick.play();
      const res = await fetch('/api/leaderboard');
      // ... leaderboard logic ...
      isLeaderboardLoading = false;
    };
  });

  // Collisions
  this.physics.add.overlap(circle1, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle2, obstacles, triggerGameOver, null, this);
  this.physics.add.overlap(circle1, points, collectPoint, null, this);
  this.physics.add.overlap(circle2, points, collectPoint, null, this);
}

// —— Update Loop ——
function update() {
  if (gameOver) return;

  const scene = this;
  let dt = (gameStarted && !gamePaused) ? 0.05 * direction : 0;
  angle += dt;
  const o1 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle).scale(radius);
  const o2 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle + Math.PI).scale(radius);

  circle1.setPosition(scene.cameras.main.centerX + o1.x, scene.cameras.main.centerY + o1.y);
  circle2.setPosition(scene.cameras.main.centerX + o2.x, scene.cameras.main.centerY + o2.y);

  if (gameStarted && !gamePaused) {
    // Move & cleanup obstacles off-screen
    obstacles.children.iterate(o => {
      o.x -= speed;
      if (o.x < -50) {
        o.destroy();
      }
    });
    // Move & cleanup points off-screen
    points.children.iterate(p => {
      p.x -= speed;
      if (p.x < -50) {
        p.destroy();
      }
    });
  }
}

// —— Spawn Logic ——
function spawnObjects() {
  const scene = window.game.scene.keys.default;
  const y = Phaser.Math.Between(100, 500);
  const x = scene.cameras.main.width + 50;
  const vx = -speed;

  if (Math.random() < 0.3) {
    const p = scene.physics.add.image(x, y, 'point').setDepth(1);
    p.body.setCircle(12).setOffset(-12, -12).setVelocityX(vx);
    points.add(p);
  } else {
    const o = scene.physics.add.image(x, y, 'obstacle').setDepth(1);
    o.body.setSize(50, 50).setOffset(-25, -25).setImmovable(true).setVelocityX(vx);
    obstacles.add(o);
  }
}

// —— Collision Handlers ——
function collectPoint(circle, point) {
  point.destroy();
  highScore++;
  document.getElementById('scoreDisplay').innerText = highScore;
  this.sound.play('pointSfx');
}

function triggerGameOver() {
  if (spawnTimer) spawnTimer.remove(false);
  if (gameOver) return;
  gameOver = true;
  [circle1, circle2].forEach(c => {
    const px = c.x, py = c.y;
    c.destroy();
    const emitter = window.game.scene.keys.default.add.particles('orb').createEmitter({
      x: px, y: py,
      speed: { min: 150, max: 350 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      lifespan: 500, blendMode: 'ADD', quantity: 8
    });
    window.game.scene.keys.default.time.delayedCall(1000, () => emitter.manager.destroy());
  });
  this.sound.play('hitSfx');
  fadeOutElement(document.getElementById('game-canvas'));
  setTimeout(() => {
    document.getElementById('game-over-screen').style.display = 'block';
  }, 600);
}
