let cachedLeaderboard = null;
let leaderboardFetched = false;
let spawnIntervalUpdater = null; // Add this global with other timers
let surpassedBest = false;
let newBestText; // For "NEW BEST" animated UI
let newBestJustSurpassed = false;

// UI elements for login/auth flow
// --- UI Elements (put at the top of your game.js) ---
// UI Elements (make sure these IDs match your index.html)
const authLoading   = document.getElementById('auth-loading');
const usernameLabel = document.getElementById('username');
const loginBtn      = document.getElementById('loginBtn');
const userInfo      = document.getElementById('user-info');
const startScreen   = document.getElementById('start-screen');

// Globals
let piUsername = '';
let piToken = null;
let useLocalHighScore = true;
let allBestScores = {};
let selectedModeId = null;
let highScore = 0;
let availableModes = [];




function waitForPiSDK(timeout = 4000) {
  return new Promise(resolve => {
    if (window.Pi && typeof window.Pi.authenticate === "function") {
      resolve();
      return;
    }
    let waited = 0;
    const check = () => {
      if (window.Pi && typeof window.Pi.authenticate === "function") {
        resolve();
      } else if ((waited += 100) >= timeout) {
        resolve(); // Timeout, continue as guest
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}


function getLocalBestScore(modeId) {
  return parseInt(localStorage.getItem(`tricky_high_score_${modeId}`), 10) || 0;
}
function setLocalBestScore(modeId, score) {
  localStorage.setItem(`tricky_high_score_${modeId}`, score);
}


const BACKEND_BASE = 'https://tricky-turns-backend.onrender.com';

async function fetchGameModes() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/modes`);
    if (res.ok) {
      availableModes = await res.json();
    }
  } catch (e) {
    // fallback remains
  }
}



function populateModeButtons() {
  const container = document.getElementById("modesPicker");
  if (!container) return;
  container.innerHTML = '';
  availableModes.forEach(mode => {
    const btn = document.createElement("button");
    btn.textContent = mode.name;
    btn.className = "btn-primary";
    // Only Classic launches the game, others do nothing for now
btn.onclick = () => {
  selectedModeId = mode.id;
  Array.from(container.children).forEach(b => b.classList.remove('active-mode'));
  btn.classList.add('active-mode');
  highScore = allBestScores[selectedModeId] || 0;  // <-- ADD THIS
  updateBestScoreEverywhere();
  if (mode.name.toLowerCase() === "classic") {
    handleStartGame();
  }
};

    container.appendChild(btn);
    // Set Classic as default selected
    if (selectedModeId === null && mode.name.toLowerCase() === "classic") {
      selectedModeId = mode.id;
      btn.classList.add('active-mode');
    }
  });
}

async function fetchAllBestScores() {
  allBestScores = {};
  if (window.piToken) {
    // Authenticated user: fetch from backend per mode
    for (const mode of availableModes) {
      try {
        const res = await fetch(`${BACKEND_BASE}/api/leaderboard/me?mode_id=${mode.id}`, {
          credentials: "include"
        });
        if (res.ok) {
          const data = await res.json();
          allBestScores[mode.id] = data.score || 0;
        } else {
          allBestScores[mode.id] = 0;
        }
      } catch {
        allBestScores[mode.id] = 0;
      }
    }
  } else {
    // Guest: fetch from localStorage per mode
    for (const mode of availableModes) {
      allBestScores[mode.id] = getLocalBestScore(mode.id);
    }
  }
}


function getLocalBestScore(modeId) {
  return parseInt(localStorage.getItem(`tricky_high_score_${modeId}`), 10) || 0;
}
function setLocalBestScore(modeId, score) {
  localStorage.setItem(`tricky_high_score_${modeId}`, score);
}

function isPiBrowser() {
  return typeof window.Pi !== 'undefined';
}



async function preloadLeaderboard() {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/leaderboard?top=100`)
    cachedLeaderboard = await res.json();
    leaderboardFetched = true;
  } catch (err) {
    console.warn('Failed to preload leaderboard:', err);
  }
}

function showScreen(id, display = 'flex') {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    el.style.display = display;
  }
}

function hideScreen(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('hidden');
    el.style.display = 'none';
  }
}

// ==========================
//   TRICKY TURNS GAME CONFIG
// ==========================
//
// All gameplay, FX, starfield, and UI variables are here for easy tuning!

const GAME_CONFIG = {
  // --- Core gameplay geometry ---
  NUM_LANES: 3,
  RADIUS: 100,
  // --- Spawn mechanics ---
  SPAWN_BUFFER_X: 185,
  SPAWN_INTERVAL_MIN: 300,
  SPAWN_INTERVAL_MAX: 700,
  SPAWN_INTERVAL_BASE_SPEED: 3,
  FORCED_SPAWN_INTERVAL: 1000,
  // --- Orb movement ---
  ANGULAR_BASE: 0.05,
  ANGULAR_SCALE: 0.005,
  // --- Obstacle/point speed ---
  SPEED_START: 3,
  SPEED_MAX: 15,
  SPEED_RAMP: [
    { until: 10,   perTick: 0.05 },
    { until: 35,   perTick: 0.1 },
    { until: 9999, perTick: 0.15 }
  ],
  // --- Point spawn probability ---
  POINT_CHANCE: [
    { until: 20,   percent: 65 },
    { until: 50,   percent: 50 },
    { until: 9999, percent: 35 }
  ],
  // --- FX: Particle & Camera Shake ---
  PARTICLES: {
    crash: {
      color: 0xffffff,
      quantity: 18,
      speedMin: 250,
      speedMax: 480,
      scaleStart: 0.85,
      scaleEnd: 0,
      lifespan: 750
    }
  },
  CAMERA_SHAKE: {
    crash:   { duration: 300, intensity: 0.035 },
    collect: { duration: 0,   intensity: 0 }
  },
  // --- Parallax Twinkling Starfield ---
  // Each layer: { speed, count, color, alpha, sizeMin, sizeMax, twinkle }
  STARFIELD_LAYERS: [
    // Farthest, most numerous, faintest, tiny
    { speed: 0.09, count: 120, color: 0xffffff, alpha: 0.13, sizeMin: 0.7, sizeMax: 1.4, twinkle: 0.10 },
    // Mid layer, fewer, bigger, more twinkle
    { speed: 0.24, count: 36,  color: 0xcbe8fd, alpha: 0.22, sizeMin: 1.3, sizeMax: 2.6, twinkle: 0.17 },
    // Closest, rare, brightest, big twinkle
    { speed: 0.53, count: 8,   color: 0xffffff, alpha: 0.40, sizeMin: 2.2, sizeMax: 4.5, twinkle: 0.33 }
  ]
};
//
// ==========================

  function getSpawnInterval() {
    let baseSpeed = GAME_CONFIG.SPAWN_INTERVAL_BASE_SPEED;
    let minDelay = GAME_CONFIG.SPAWN_INTERVAL_MIN, maxDelay = GAME_CONFIG.SPAWN_INTERVAL_MAX;
    let t = Math.min((speed - baseSpeed) / (maxSpeed - baseSpeed), 1);
    let interval = Math.max(maxDelay - (maxDelay - minDelay) * t, minDelay);
    return interval + Phaser.Math.Between(-50, 50);
  }

const muteBtnHome = document.getElementById('muteToggleHome');
let isLeaderboardLoading = false;
let spawnEvent = null;
let speed = GAME_CONFIG.SPEED_START;
let maxSpeed = GAME_CONFIG.SPEED_MAX;
let radius = GAME_CONFIG.RADIUS;

let laneLastObstacleXs = Array(GAME_CONFIG.NUM_LANES).fill(null);
let laneLastPointXs = Array(GAME_CONFIG.NUM_LANES).fill(null);
let lastSpawnTimestamp = 0;

// --- Starfield globals ---
let starfieldLayers = [];

let piInitPromise = null;

function showDebug(msg) {
  const box = document.getElementById('debugBox');
  if (!box) return;
  box.style.display = 'block';
  box.innerText = '[DEBUG] ' + msg;
}


async function initAuth() {
  // Show loading UI
  authLoading.classList.remove('hidden');
  usernameLabel.classList.add('hidden');
  loginBtn.classList.add('hidden');

  piUsername = '';
  piToken = null;
  useLocalHighScore = true;

  // Always fetch modes first (they are needed for everything else)
  await fetchGameModes();

  // Default: Guest flow (will overwrite if Pi auth succeeds)
  let loginSuccess = false;

  try {
    // --- Pi Browser Auth Flow ---
    if (typeof Pi !== "undefined" && Pi.init && Pi.authenticate) {
      await Pi.init({ version: "2.0", sandbox: true });
      const auth = await Pi.authenticate(['username']);
      if (auth && auth.user && auth.accessToken) {
        piUsername = auth.user.username;
        piToken = auth.accessToken;
        useLocalHighScore = false;
        loginSuccess = true;
      }
    }
  } catch (err) {
    // Pi Browser, but auth failed or cancelled (stay as guest)
    loginSuccess = false;
  }

  // --- Load best scores for all modes ---
  allBestScores = {};
  if (loginSuccess && piToken) {
    // Authenticated: fetch from API
    for (const mode of availableModes) {
      try {
        const res = await fetch(`${BACKEND_BASE}/api/leaderboard/me?mode_id=${mode.id}`, {
          credentials: "include"
        });
        if (res.ok) {
          const data = await res.json();
          allBestScores[mode.id] = data.score || 0;
        } else {
          allBestScores[mode.id] = 0;
        }
      } catch {
        allBestScores[mode.id] = 0;
      }
    }
  } else {
    // Guest: fetch all bests from localStorage
    for (const mode of availableModes) {
      allBestScores[mode.id] = getLocalBestScore(mode.id);
    }
    piUsername = 'Guest';
    useLocalHighScore = true;
  }

  // Pick default mode if not set
  if (!selectedModeId) {
    selectedModeId =
      availableModes.find(m => m.name.toLowerCase() === 'classic')?.id ||
      availableModes[0]?.id ||
      1;
  }

  // Set initial best for selected mode
  highScore = allBestScores[selectedModeId] || 0;
  updateBestScoreEverywhere();

  // Show UI
  usernameLabel.innerText = piUsername || 'Guest';
  userInfo.classList.toggle('logged-in', !useLocalHighScore);
  userInfo.classList.toggle('guest', useLocalHighScore);
  authLoading.classList.add('hidden');
  usernameLabel.classList.remove('hidden');
  loginBtn.classList.remove('hidden');
  startScreen.classList.add('ready');

  // Optional: debug window/log
  showDebug(
    (useLocalHighScore
      ? `Guest mode: loaded highScores from localStorage`
      : `Logged in as @${piUsername}: loaded highScores from API`)
  );
}


const scopes = ['username'];

function onIncompletePaymentFound(payment) {
  console.log('Incomplete payment found:', payment);
}
// Full drop-in for initAuth in game.js
  // --- Helper for guest mode ---

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
  const lb = document.getElementById('leaderboard-screen');
  lb.classList.remove('hidden');
  lb.style.display = 'flex';
  requestAnimationFrame(() => lb.classList.add('visible'));

  const list = document.getElementById('leaderboardEntriesHome');
  list.innerHTML = '';

  // Use selectedModeId (fallback to Classic if null)
  let modeId = selectedModeId || (availableModes.find(m => m.name.toLowerCase() === "classic")?.id);
  const data = await fetch(`${BACKEND_BASE}/api/leaderboard?top=100&mode_id=${modeId}`).then(r => r.json());

  data.forEach((e, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="rank-badge">#${i + 1}</span>
      <span class="entry-username">${e.username}</span>
      <span class="entry-score">${e.score}</span>`;
    li.style.setProperty('--i', i);
    li.classList.add('animated-entry');
    list.appendChild(li);
  });

  // Show the mode in the header!
  const header = document.getElementById('leaderboardHeader');
  const modeName = availableModes.find(m => m.id === modeId)?.name || "Classic";
  header.textContent = `Top 100 Leaderboard (${modeName})`;
}


function updateBestScoreEverywhere() {
  // Phaser HUD
  if (window.game && window.game.scene && window.game.scene.keys.default) {
    const scene = window.game.scene.keys.default;
    if (scene.bestScoreText) scene.bestScoreText.setText('Best: ' + highScore);
  }
  // Game over DOM
  const bestScoreDom = document.getElementById('bestScore');
  if (bestScoreDom) bestScoreDom.innerText = highScore;
}

function resetGameUIState(scene) {
  newBestJustSurpassed = false;
  score = 0;
  speed = GAME_CONFIG.SPEED_START;
  direction = 1;
  gameStarted = false;
  gameOver = false;
  gamePaused = false;
  laneLastObstacleXs = Array(GAME_CONFIG.NUM_LANES).fill(null);
  laneLastPointXs = Array(GAME_CONFIG.NUM_LANES).fill(null);
  lastSpawnTimestamp = 0;

  // DOM UI reset
['game-over-screen', 'leaderboard-screen', 'pause-overlay', 'start-screen'].forEach(hideScreen);


  // Reset result blocks
  const newHighScoreBlock = document.getElementById('newHighScoreBlock');
  const bestBlock = document.getElementById('bestBlock');
  const scoreBlock = document.getElementById('scoreBlock');
  if (newHighScoreBlock) newHighScoreBlock.style.display = 'none';
  if (bestBlock) bestBlock.style.display = '';
  if (scoreBlock) scoreBlock.style.display = '';

  // HUD state reset
  surpassedBest = false;
  if (scoreText) scoreText.setVisible(true);
  if (bestScoreText) bestScoreText.setVisible(true);
  if (newBestText) newBestText.setVisible(false);

  if (scene?.scoreText) scene.scoreText.setVisible(true);
  if (scene?.bestScoreText) scene.bestScoreText.setVisible(true);
  if (scene?.newBestText) scene.newBestText.setVisible(false);

  if (muteBtnHome) muteBtnHome.style.display = 'none';
  const canvas = document.querySelector('canvas');
  if (canvas) canvas.style.visibility = 'visible';
  window.scrollTo(0, 0);
}



const LANES = [];
let gameStarted = false, gameOver = false, gamePaused = false;
let direction = 1, angle = 0;
let circle1, circle2, obstacles, points, score = 0;
let muteIcon, bestScoreText, scoreText, pauseIcon, pauseOverlay, countdownText;
let sfx = {}, isMuted = false;
let pauseIconLocked = false;

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

function getConfigRamp(arr, val) {
  for (let i = 0; i < arr.length; i++) {
    if (val < arr[i].until) return arr[i];
  }
  return arr[arr.length - 1];
}

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
function scheduleSpawnEvents(scene) {
  if (spawnEvent) spawnEvent.remove(false);
  spawnEvent = scene.time.addEvent({
    delay: getSpawnInterval(),
    loop: true,
    callback: () => {
      if (gameStarted && !gameOver && !gamePaused) {
        spawnObjects.call(scene);
        lastSpawnTimestamp = scene.time.now;
      }
    }
  });

  // Periodically (every 5s) update the spawn interval for smooth ramping
  if (spawnIntervalUpdater) spawnIntervalUpdater.remove(false);
  spawnIntervalUpdater = scene.time.addEvent({
    delay: 5000, // You can tune this to 3000ms or 7000ms, etc.
    loop: true,
    callback: () => {
      if (spawnEvent) {
        let newDelay = getSpawnInterval();
        spawnEvent.reset({ delay: newDelay, loop: true });
      }
    }
  });
}

function create() {
  const cam = this.cameras.main;
  const cx = cam.centerX, cy = cam.centerY;

  // --- Twinkling Starfield Parallax Setup ---
  if (starfieldLayers.length) {
    starfieldLayers.forEach(layer => layer.stars.forEach(s => s.g.destroy()));
  }
  starfieldLayers = [];
  let t0 = performance.now() / 1000;
  GAME_CONFIG.STARFIELD_LAYERS.forEach((layer, i) => {
    let stars = [];
    for (let n = 0; n < layer.count; n++) {
      const x = Math.random() * cam.width;
      const y = Math.random() * cam.height;
      const size = layer.sizeMin + Math.random() * (layer.sizeMax - layer.sizeMin);
      const baseAlpha = layer.alpha * (0.85 + 0.3 * Math.random());
      const tw = Math.random() * Math.PI * 2;
      const g = this.add.graphics();
      g.fillStyle(layer.color, 1);
      g.fillCircle(0, 0, size);
      g.x = x;
      g.y = y;
      g.setDepth(-100 + i);
      stars.push({ g, x, y, size, baseAlpha, tw });
    }
    starfieldLayers.push({ stars, layer });
  });
  // --- End Starfield Parallax ---

  for (let i = 0; i < GAME_CONFIG.NUM_LANES; i++) {
    LANES[i] = cy + (i - Math.floor(GAME_CONFIG.NUM_LANES / 2)) * radius;
  }

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

  // ==== SCORE TEXTS ====
  scoreText = this.scoreText = this.add.text(16, 16, 'Score: 0', {
    fontFamily: 'Poppins',
    fontSize: '28px',
    fontStyle: 'bold',
    color: '#ffffff',
    stroke: '#1a7ef2',
    strokeThickness: 3,
    shadow: { offsetX: 1, offsetY: 1, color: '#000000', blur: 1, fill: true }
  }).setDepth(10).setVisible(true);

  bestScoreText = this.bestScoreText = this.add.text(16, 56, 'Best: ' + highScore, {
    fontFamily: 'Poppins',
    fontSize: '28px',
    fontStyle: 'bold',
    color: '#ffffff',
    stroke: '#1a7ef2',
    strokeThickness: 3,
    shadow: { offsetX: 1, offsetY: 1, color: '#000000', blur: 1, fill: true }
  }).setDepth(10).setVisible(true);

  // ==== NEW BEST TEXT (Initially Hidden) ====
  newBestText = this.newBestText = this.add.text(16, 16, '', {
    fontFamily: 'Poppins',
    fontSize: '28px',
    fontStyle: 'bold',
    color: '#ffe167',
    stroke: '#f89e2c',
    strokeThickness: 4,
    shadow: { offsetX: 1, offsetY: 2, color: '#ffae00a0', blur: 12, fill: true }
  }).setDepth(11).setVisible(false);
  updateBestScoreEverywhere();
  pauseIcon = this.add.image(cam.width - 40, 40, 'iconPause').setInteractive({ useHandCursor: true }).setDepth(3).setVisible(false);
  muteIcon = this.add.image(cam.width - 100, 40, 'iconUnmute').setInteractive({ useHandCursor: true }).setDepth(4).setVisible(false);
  window.muteIcon = muteIcon;
  this.sound.mute = isMuted;
  muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
  if (muteBtnHome) muteBtnHome.src = currentMuteIcon();
  pauseOverlay = document.getElementById('pause-overlay');

  // ======= HOVER EFFECTS FOR PAUSE & MUTE ICONS =======
  pauseIcon
    .on('pointerover', function () {
      this.setScale(1.13); // Light blue
    })
    .on('pointerout', function () {
      this.setScale(1);
    });
  muteIcon
    .on('pointerover', function () {
      this.setScale(1.13);
    })
    .on('pointerout', function () {
      this.setScale(1);
    });
  // ====================================================

  countdownText = this.add.text(cx, cy, '', {
    fontFamily: 'Poppins',
    fontSize: '96px',
    fontStyle: 'bold',
    color: '#ffffff',
    stroke: '#25b7e6',
    strokeThickness: 2,
    shadow: { offsetX: 1.5, offsetY: 3, color: '#23b6e9cc', blur: 12, fill: true }
  }).setOrigin(0.5).setDepth(1000).setVisible(false);

  this.countdownText = countdownText;
  this.scoreText = scoreText;
  this.bestScoreText = bestScoreText;
  this.newBestText = newBestText;
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

  // Speed ramp-up based on score and config
  this.time.addEvent({
    delay: 1000, loop: true,
    callback: () => {
      if (gameStarted && !gameOver && !gamePaused) {
        let ramp = getConfigRamp(GAME_CONFIG.SPEED_RAMP, score).perTick;
        speed = Math.min(speed + ramp, maxSpeed);
      }
    }
  });

  scheduleSpawnEvents(this);

  this.time.addEvent({
    delay: 250,
    loop: true,
    callback: () => {
      if (!gameStarted || gameOver || gamePaused) return;
      if (this.time.now - lastSpawnTimestamp > GAME_CONFIG.FORCED_SPAWN_INTERVAL) {
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

  pauseIcon.on('pointerdown', (_, x, y, e) => {
    if (pauseIconLocked) return;
    pauseIconLocked = true;
    e.stopPropagation();
    if (!gameStarted || gameOver) {
      pauseIconLocked = false;
      return;
    }
    if (!gamePaused) {
      gamePaused = true;
      pauseIcon.setTexture('iconPlay');
      sfx.pauseWhoosh.play();
      this.physics.pause();
      pauseOverlay.classList.remove('hidden');
      pauseOverlay.style.display = 'flex';
      setTimeout(() => { pauseIconLocked = false; }, 300);
    } else {
      sfx.pauseWhoosh.play();
      pauseOverlay.classList.add('hidden');
      pauseOverlay.style.display = '';
      let count = 3;
      countdownText.setText(count).setVisible(true).setDepth(1000);

      const resumeEvent = this.time.addEvent({
        delay: 1000, repeat: 2,
        callback: () => {
          count--;
          if (count > 0) countdownText.setText(count);
          else {
            countdownText.setVisible(false);
            gamePaused = false;
            pauseIcon.setTexture('iconPause');
            this.physics.resume();
            pauseIconLocked = false;
          }
        }
      });
    }
  });

  muteIcon.on('pointerdown', () => {
    isMuted = !isMuted;
    this.sound.mute = isMuted;
    muteIcon.setTexture(isMuted ? 'iconUnmute' : 'iconMute');
    if (muteBtnHome) muteBtnHome.src = currentMuteIcon();
    if (!isMuted) sfx.uiClick.play();
  });

this.input.on('pointerdown', (pointer, currentlyOver) => {
  // Ignore only if pause/mute or a major overlay is actually visible
  const gameOverOpen = document.getElementById('game-over-screen')?.style.display === 'flex';
  const startScreenOpen = document.getElementById('start-screen')?.style.display !== 'none' &&
                          !document.getElementById('start-screen')?.classList.contains('hidden');

  if (gameOverOpen || startScreenOpen) return; // Prevent input if overlay is open

  // Ignore pause/mute buttons if tapped directly
  if (currentlyOver && currentlyOver.some(obj =>
    obj === this.pauseIcon || obj === this.muteIcon
  )) return;

  // --- FULL SCREEN: Always allow touch anywhere to rotate! ---
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




// DELTA TIME PATCHED update
function update(time, delta) {
  // --- Twinkling Starfield Update (always moves, even paused/gameOver) ---
  if (starfieldLayers.length) {
    const t = performance.now() / 1000;
    const camWidth = this.cameras.main.width;
    const camHeight = this.cameras.main.height;
    starfieldLayers.forEach(({ stars, layer }) => {
      stars.forEach(s => {
        // Move star
        s.x -= layer.speed * (delta ? (delta / (1000 / 60)) : 1);
        if (s.x < -s.size) {
          s.x += camWidth + s.size * 2;
          s.y = Math.random() * camHeight;
          s.tw = Math.random() * Math.PI * 2; // new twinkle phase
        }
        s.g.x = s.x;
        s.g.y = s.y;
        // Twinkle: oscillate alpha using unique phase
        const tw = Math.sin(t * (0.7 + 0.6 * layer.twinkle) + s.tw);
        s.g.alpha = Math.max(0, Math.min(1, s.baseAlpha + layer.twinkle * tw));
      });
    });
  }

  if (gameOver) return;
  let ANGULAR_BASE = GAME_CONFIG.ANGULAR_BASE;
  let ANGULAR_SCALE = GAME_CONFIG.ANGULAR_SCALE;
  let dt = (gameStarted && !gamePaused)
    ? (ANGULAR_BASE + ANGULAR_SCALE * (speed - GAME_CONFIG.SPEED_START)) * direction
    : 0;

  angle += dt;
  const o1 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle).scale(radius);
  const o2 = Phaser.Math.Vector2.RIGHT.clone().rotate(angle + Math.PI).scale(radius);

  circle1.setPosition(this.cameras.main.centerX + o1.x, this.cameras.main.centerY + o1.y);
  circle2.setPosition(this.cameras.main.centerX + o2.x, this.cameras.main.centerY + o2.y);

  let norm = delta ? (delta / (1000 / 60)) : 1;
  if (gameStarted && !gamePaused) {
    obstacles.children.iterate((o) => {
      if (o) {
        o.x -= speed * norm;
        if (o.x < -100 || o.x > this.cameras.main.width + 100) {
          for (let i = 0; i < GAME_CONFIG.NUM_LANES; i++) {
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
        p.x -= speed * norm;
        if (p.x < -100 || p.x > this.cameras.main.width + 100) {
          for (let i = 0; i < GAME_CONFIG.NUM_LANES; i++) {
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

function getPointChance(score) {
  return getConfigRamp(GAME_CONFIG.POINT_CHANCE, score).percent;
}

// --- Patch: Points and obstacles never overlap in the same lane ---
function spawnObjects() {
  const scene = window.game.scene.keys.default;
  const camWidth = scene.cameras.main.width;
  const fromLeft = Phaser.Math.Between(0, 1) === 0;
  const x = fromLeft ? -50 : camWidth + 50;
  const vx = (fromLeft ? speed : -speed) * 60;
  let pointChance = getPointChance(score);

  let safeObstacleLanes = [];
  let safePointLanes = [];
  for (let lane = 0; lane < GAME_CONFIG.NUM_LANES; lane++) {
    // Obstacles: check for nearby obstacles AND points
    let obsSafe = true;
    for (let adj = -1; adj <= 1; adj++) {
      let checkLane = lane + adj;
      if (checkLane < 0 || checkLane >= GAME_CONFIG.NUM_LANES) continue;
      let lastObsX = laneLastObstacleXs[checkLane];
      if (lastObsX !== null && Math.abs(lastObsX - x) < GAME_CONFIG.SPAWN_BUFFER_X) {
        obsSafe = false;
        break;
      }
    }
    let lastPtX = laneLastPointXs[lane];
    if (obsSafe && (lastPtX === null || Math.abs(lastPtX - x) >= GAME_CONFIG.SPAWN_BUFFER_X)) {
      safeObstacleLanes.push(lane);
    }

    // Points: check for nearby obstacles AND points
    let ptSafe = true;
    for (let adj = -1; adj <= 1; adj++) {
      let checkLane = lane + adj;
      if (checkLane < 0 || checkLane >= GAME_CONFIG.NUM_LANES) continue;
      let lastObsX = laneLastObstacleXs[checkLane];
      if (lastObsX !== null && Math.abs(lastObsX - x) < GAME_CONFIG.SPAWN_BUFFER_X) {
        ptSafe = false;
        break;
      }
    }
    let lastPtX2 = laneLastPointXs[lane];
    if (ptSafe && (lastPtX2 === null || Math.abs(lastPtX2 - x) >= GAME_CONFIG.SPAWN_BUFFER_X)) {
      safePointLanes.push(lane);
    }
  }

  // Points first: Spawn one point if possible and allowed by chance
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

  // Obstacles: spawn only in lanes where we didn't just spawn a point
  if (safeObstacleLanes.length > 0) {
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

  // --- Camera shake & particle burst on crash ---
  let fx = GAME_CONFIG.PARTICLES.crash;
  let camShake = GAME_CONFIG.CAMERA_SHAKE.crash;
  let cam = window.game.scene.keys.default.cameras.main;
  if (cam && camShake.intensity > 0) cam.shake(camShake.duration, camShake.intensity);

  [circle1, circle2].forEach(c => {
    const px = c.x, py = c.y; c.destroy();
    const emitter = window.game.scene.keys.default.add.particles('orb').createEmitter({
      x: px, y: py,
      speed: { min: fx.speedMin, max: fx.speedMax },
      angle: { min: 0, max: 360 },
      scale: { start: fx.scaleStart, end: fx.scaleEnd },
      lifespan: fx.lifespan, blendMode: 'ADD',
      quantity: fx.quantity
    });
    window.game.scene.keys.default.time.delayedCall(1000, () => emitter.manager.destroy());
  });
  sfx.explode.play();

  // -- DOM references for all result UI blocks --
  const newHighScoreBlock = document.getElementById('newHighScoreBlock');
  const newHighScoreValue = document.getElementById('newHighScoreValue');
  const bestBlock = document.getElementById('bestBlock');
  const scoreBlock = document.getElementById('scoreBlock');

  // --- Reset state (both class and display) ---
  if (newHighScoreBlock) {
    newHighScoreBlock.classList.add('hidden');
    newHighScoreBlock.style.display = 'none';
  }
  if (bestBlock) bestBlock.style.display = '';
  if (scoreBlock) scoreBlock.style.display = '';

  window.game.scene.keys.default.time.delayedCall(700, async () => {
    window.game.scene.keys.default.physics.pause();
    document.querySelector('canvas').style.visibility = 'hidden';

    const isNewHigh = score > highScore;

    if (isNewHigh) {
      if (newHighScoreBlock) {
        newHighScoreBlock.classList.remove('hidden');
        newHighScoreBlock.style.display = 'flex';
      }
      if (newHighScoreValue) newHighScoreValue.innerText = score;
      if (bestBlock) bestBlock.style.display = 'none';
      if (scoreBlock) scoreBlock.style.display = 'none';
      highScore = score;
      sfx.newBest.play();
      updateBestScoreEverywhere();
    } else {
      if (newHighScoreBlock) {
        newHighScoreBlock.classList.add('hidden');
        newHighScoreBlock.style.display = 'none';
      }
      if (bestBlock) bestBlock.style.display = '';
      if (scoreBlock) scoreBlock.style.display = '';
    }

    document.getElementById('finalScore').innerText = score;
    document.getElementById('bestScore').innerText = highScore;
    if (typeof bestScoreText !== 'undefined') bestScoreText.setText('Best: ' + highScore);

if (useLocalHighScore) {
    // Ensure we only ever overwrite with a higher score
let storedScore = getLocalBestScore(selectedModeId);
if (highScore > storedScore) {
    setLocalBestScore(selectedModeId, highScore);
    allBestScores[selectedModeId] = highScore;  // Keep JS object up to date
    console.log(`[Local] New high score saved for mode ${selectedModeId}: ${highScore}`);
}
 else {
        console.log(`[Local] Current session high score (${highScore}) did not beat stored (${storedScore}), not saved.`);
    }
    updateBestScoreEverywhere();
}
 else if (piToken) {
      // POST score, then re-fetch to sync
      try {
        await fetch(`${BACKEND_BASE}/api/leaderboard`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${piToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    score: highScore,
    username: piUsername,
    mode_id: selectedModeId      // <--- Add this!
  })
});

const res = await fetch(`${BACKEND_BASE}/api/leaderboard/me?mode_id=${selectedModeId}`, {
  headers: { Authorization: `Bearer ${piToken}` }
});

        if (res.ok) {
          const data = await res.json();
          highScore = data.score || highScore;
          updateBestScoreEverywhere();
        }
      } catch (e) {}
    }

    if (muteBtnHome) muteBtnHome.style.display = 'none';
  showScreen('game-over-screen', 'flex');


    const rankMessage = document.getElementById('rankMessage');
    if (rankMessage) rankMessage.innerText = "";

    // --- Leaderboard/rank logic (unchanged) ---
    (async () => {
      if (!useLocalHighScore && piToken) {
        try {
          const res = await fetch(`${BACKEND_BASE}/api/leaderboard/rank`, {
            headers: { Authorization: `Bearer ${piToken}` }
          });
          if (res.ok) {
            const { rank } = await res.json();
            if (rankMessage) {
              rankMessage.innerText = `🏅 Your Global Rank: #${rank}`;
              rankMessage.classList.remove('dimmed');
            }
          } else {
            if (rankMessage) {
              rankMessage.innerText = `💡 You're currently unranked — keep playing!`;
            }
          }
        } catch (e) {
          if (rankMessage) {
            rankMessage.innerText = `💡 You're currently unranked — keep playing!`;
          }
        }
      } else {
        if (rankMessage) {
          rankMessage.innerText = `🔓 Sign in to track your global rank`;
          rankMessage.classList.add('dimmed');
        }
      }
    })();
    // --- End leaderboard logic ---
  });
}



function collectPoint(_, pt) {
  if (pt.glow) pt.glow.destroy();

  let scene = window.game.scene.keys.default;
  const plusOne = scene.add.text(pt.x, pt.y, '+1', {
    fontFamily: 'Poppins',
    fontSize: '32px',
    color: '#fff',
    stroke: '#2ed573',
    strokeThickness: 4,
    fontStyle: 'bold'
  }).setOrigin(0.5).setDepth(10);

  scene.tweens.add({
    targets: plusOne,
    y: pt.y - 40,
    alpha: 0,
    scale: 1.2,
    duration: 500,
    ease: 'Cubic.easeOut',
    onComplete: () => plusOne.destroy()
  });

  pt.destroy();
  score++;
  sfx.point.play();

  // ==== PREMIUM SCORE HANDLING ====
  if (!surpassedBest && score > highScore) {
    // First time surpassing best: switch to NEW BEST
    surpassedBest = true;
    scoreText.setVisible(false);
    bestScoreText.setVisible(false);

    // Place NEW BEST in the same spot as Score was
    newBestText.setVisible(true);
    newBestText.setText('NEW BEST: ' + score);

    // One-time flourish animation & sound
scene.tweens.add({
  targets: newBestText,
  scaleX: 1.27, scaleY: 1.27,
  yoyo: true, duration: 340, ease: 'Back.easeOut'
});
// Always ensure the text is visible!
newBestText.setAlpha(1);

    sfx.newBest.play();

  } else if (surpassedBest) {
    // Already surpassed: just keep updating NEW BEST with no animation
    newBestText.setVisible(true); // Ensure always visible
    newBestText.setText('NEW BEST: ' + score);
    // NO animation or flicker—just update number!
  } else {
    // Standard: show Score and Best as usual
    scoreText.setVisible(true);
    bestScoreText.setVisible(true);
    scoreText.setText('Score: ' + score);

    scene.tweens.add({
      targets: scoreText,
      scaleX: 1.1, scaleY: 1.1,
      yoyo: true, duration: 80, ease: 'Sine.easeOut'
    });
  }
}





function handleStartGame() {
  highScore = allBestScores[selectedModeId] || 0;
  updateBestScoreEverywhere();

  sfx.uiClick.play();
  document.getElementById('user-info').classList.add('hidden');
  document.getElementById('viewLeaderboardBtn').classList.add('hidden');
  document.getElementById('start-screen').classList.add('hidden');
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
    });
  }, 200);
}


function handleGoHome() {
  fadeIn(() => {
    const scene = window.game.scene.keys.default;
    scene.scene.restart();
    resetGameUIState(scene);

    if (muteBtnHome) muteBtnHome.style.display = 'block';
    document.querySelector('canvas').style.visibility = 'hidden';

    showScreen('user-info');
    showScreen('viewLeaderboardBtn');
    showScreen('start-screen');

    hideScreen('pause-overlay');
    document.getElementById('user-info').classList.add('visible');

    fadeOut();
  });
}





function handlePlayAgain() {
  sfx.uiClick.play();

  const scene = window.game.scene.keys.default;

  if (scene.trail) { scene.trail.destroy(); scene.trail = null; }
  if (spawnEvent) spawnEvent.remove(false);
  if (spawnIntervalUpdater) spawnIntervalUpdater.remove(false);

  scene.scene.restart();
  scene.events.once('create', () => {
    resetGameUIState(scene);
    scheduleSpawnEvents(scene);
    scene.pauseIcon.setVisible(true);
    scene.muteIcon.setVisible(true);
    scene.startCountdown(() => { gameStarted = true; });
  });
}




window.addEventListener('DOMContentLoaded', async () => {
  // --- AUTH / USER INFO ---
  await initAuth();

  // --- Load Modes, THEN all best scores, THEN build mode picker --
  populateModeButtons();

  // --- UI BUTTONS ---
  document.getElementById('homeBtn').onclick = handleGoHome;

  const leaderboardBtn = document.getElementById('viewLeaderboardBtn');
  leaderboardBtn.addEventListener('mouseenter', preloadLeaderboard);
  leaderboardBtn.addEventListener('touchstart', preloadLeaderboard);
  leaderboardBtn.addEventListener('click', showHomeLeaderboard);

  document.getElementById('closeLeaderboardBtn').addEventListener('click', () => {
    hideScreen('leaderboard-screen');
    document.getElementById('leaderboard-screen').classList.remove('visible');
  });

  const playAgainBtn = document.getElementById('playAgainBtn');
  if (playAgainBtn) playAgainBtn.onclick = handlePlayAgain;

  document.getElementById('loginBtn').addEventListener('click', initAuth);

  // --- Debug logs (optional) ---
  console.log('🌐 Detected hostname:', window.location.hostname);
  console.log('🧭 Pi browser detected?', window.location.hostname.includes('pi') || window.location.href.includes('pi://'));
});