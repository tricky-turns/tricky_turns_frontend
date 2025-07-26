// ==========================
//   TRICKY TURNS GAME CONFIG
// ==========================

const GAME_CONFIG = {
  NUM_LANES: 3,
  RADIUS: 100,
  SPAWN_BUFFER_X: 220,
  SPAWN_INTERVAL_MIN: 350,
  SPAWN_INTERVAL_MAX: 1100,
  SPAWN_INTERVAL_BASE_SPEED: 3,
  FORCED_SPAWN_INTERVAL: 1800,
  ANGULAR_BASE: 0.05,
  ANGULAR_SCALE: 0.005,
  SPEED_START: 3,
  SPEED_MAX: 20,
  SPEED_RAMP: [
    { until: 20, perTick: 0.05 },
    { until: 50, perTick: 0.75 },
    { until: 9999, perTick: 0.10 }
  ],
  POINT_CHANCE: [
    { until: 20, percent: 65 },
    { until: 50, percent: 50 },
    { until: 9999, percent: 35 }
  ],
  PARTICLES: {
    crash: {
      color: 0xffffff,
      quantity: 18,
      speedMin: 250,
      speedMax: 480,
      lifespan: 700
    }
  }
};

// ==========================
//   AUTH + API CONFIG
// ==========================

const BACKEND_URL = "https://tricky-turns-backend.onrender.com/api";
let piToken = null;

async function getPiToken() {
  if (piToken) return piToken;
  if (window?.Pi?.authenticate) {
    try {
      const scopes = ['username'];
      const auth = await Pi.authenticate(scopes);
      piToken = auth.accessToken;
      console.log("✅ Pi Token acquired:", piToken);
    } catch (err) {
      console.error("❌ Failed to authenticate with Pi:", err);
    }
  } else {
    console.warn("⚠️ Pi SDK not available in this browser.");
  }
  return piToken;
}

async function fetchWithAuth(endpoint, method = "GET", body = null) {
  if (!piToken) await getPiToken();

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${piToken}`
  };

  const options = {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  };

  const response = await fetch(`${BACKEND_URL}${endpoint}`, options);

  if (!response.ok) {
    const msg = await response.text();
    console.warn(`❌ ${method} ${endpoint} failed`, msg);
    throw new Error("Backend request failed");
  }

  return await response.json();
}

// (rest of your game logic below...)

// ==========================
//   CORE GAME STATE & LOGIC
// ==========================

let game;
let playerOrb, orbShadow, lanes = [];
let activeObstacles = [];
let activePoints = [];
let activeParticles = [];
let currentLane = 1;
let canSwitch = true;
let gameSpeed = GAME_CONFIG.SPEED_START;
let spawnTimer = 0;
let forcedSpawnTimer = 0;
let lastSpawned = null;
let points = 0;
let bestScore = 0;
let isGameOver = false;
let parallaxLayers = [];
let shakeTimeout = null;
let userMuted = false;
let startTime = 0;
let totalElapsed = 0;
let frameCount = 0;
let spawnInterval = GAME_CONFIG.SPAWN_INTERVAL_MIN;

// For audio
let gameMusic, pointSound, crashSound, swooshSound;

// UI
const pauseOverlay = document.getElementById("pause-overlay");
const leaderboardScreen = document.getElementById("leaderboard-screen");
const leaderboardEntriesHome = document.getElementById("leaderboardEntriesHome");
const leaderboardHeader = document.getElementById("leaderboardHeader");
const leaderboardRankMessage = document.getElementById("rankMessage");
const leaderboardCloseBtn = document.getElementById("closeLeaderboardBtn");
const viewLeaderboardBtn = document.getElementById("viewLeaderboardBtn");
const muteToggleHome = document.getElementById("muteToggleHome");
const startBtn = document.getElementById("startBtn");
const homeBtn = document.getElementById("homeBtn");
const playAgainBtn = document.getElementById("playAgainBtn");
const finalScoreSpan = document.getElementById("finalScore");
const bestScoreSpan = document.getElementById("bestScore");

// Parallax setup (and clouds if applicable)
function setupParallax() {
  // your parallax or background logic (not changed)
}

// ==========================
//   GAME INITIALIZATION
// ==========================

window.addEventListener("load", async () => {
  await getPiToken();   // Ensure Pi authentication before anything
  initializeGame();
  setupUI();
  // You may want to fetch best score here
  try {
    const myScore = await getMyScore();
    if (myScore && typeof myScore.score === "number") {
      bestScore = myScore.score;
      if (bestScoreSpan) bestScoreSpan.textContent = bestScore;
    }
  } catch (e) {
    console.warn("Couldn't fetch initial best score");
  }
});

function initializeGame() {
  // Phaser/game engine init
  // ...
  // All your normal engine code goes here (no changes needed)
}

// ==========================
//   SPAWN/UPDATE/DESTROY LOGIC
// ==========================

// ... all your original obstacle/point spawn, movement, collision, and destruction code ...

// ... input handling for lane switch, pause, resume, etc. ...

// ==========================
//   SCORING, GAME OVER, LEADERBOARD
// ==========================

async function submitScore(score) {
  try {
    await fetchWithAuth("/leaderboard", "POST", { score });
    console.log("✅ Score submitted:", score);
  } catch (e) {
    console.error("❌ Score submission failed:", e);
  }
}

async function getTopScores(limit = 100) {
  try {
    return await fetchWithAuth(`/leaderboard?top=${limit}`);
  } catch (e) {
    console.error("❌ Failed to fetch top scores:", e);
    return [];
  }
}

async function getMyScore() {
  try {
    return await fetchWithAuth("/leaderboard/me");
  } catch (e) {
    console.error("❌ Failed to fetch my score:", e);
    return null;
  }
}

async function getMyRank() {
  try {
    return await fetchWithAuth("/leaderboard/rank");
  } catch (e) {
    console.error("❌ Failed to fetch rank:", e);
    return null;
  }
}

function updateScoreUI() {
  if (finalScoreSpan) finalScoreSpan.textContent = points;
  if (bestScoreSpan) bestScoreSpan.textContent = bestScore;
  // Any other in-game score displays as in your original logic
}

async function onGameOver(finalScore) {
  isGameOver = true;
  points = finalScore;
  updateScoreUI();

  // Submit and refresh leaderboard
  await submitScore(finalScore);
  await showLeaderboard(finalScore);

  // Show game over screen, etc.
  document.getElementById("game-over-screen").style.display = "flex";
}

// Patch for wherever your core game loop or collision triggers game over:
// Example:
// if (playerCollidesWithObstacle) {
//   onGameOver(points);
// }

// ==========================
//   LEADERBOARD UI DISPLAY
// ==========================

async function showLeaderboard(playerScore = null) {
  leaderboardScreen.style.display = "block";
  leaderboardEntriesHome.innerHTML = "<li>Loading...</li>";
  leaderboardHeader.textContent = "Top 100 Leaderboard";

  try {
    const [topScores, myScore, myRank] = await Promise.all([
      getTopScores(),
      getMyScore(),
      getMyRank()
    ]);

    leaderboardEntriesHome.innerHTML = topScores.map((entry, i) => `
      <li class="leaderboard-entry">
        <span class="col-rank">${i + 1}</span>
        <span class="col-user">${entry.username || entry.owner_id || "?"}</span>
        <span class="col-score">${entry.score}</span>
      </li>
    `).join('');

    leaderboardRankMessage.innerHTML = myScore && myRank
      ? `Your Best: <b>${myScore.score}</b><br>Global Rank: <b>${myRank.rank}</b>`
      : "Play to set your rank!";
  } catch (e) {
    leaderboardEntriesHome.innerHTML = "<li>Could not load leaderboard.</li>";
    leaderboardRankMessage.textContent = "Leaderboard unavailable.";
  }
}

// ==========================
//   UI BUTTON SETUP / EVENTS
// ==========================

function setupUI() {
  if (leaderboardCloseBtn) {
    leaderboardCloseBtn.addEventListener("click", () => {
      leaderboardScreen.style.display = "none";
    });
  }
  if (viewLeaderboardBtn) {
    viewLeaderboardBtn.addEventListener("click", () => {
      showLeaderboard();
    });
    viewLeaderboardBtn.addEventListener("mouseenter", () => {
      getTopScores(); // Preload data for instant display
    });
  }
  // Mute, start, home, play again, etc, as in your original logic
  // ... (all button/event code preserved from your original)
}

// ... any additional UI initialization, hotkeys, etc. ...

// ==========================
//   AUDIO SETUP & FX
// ==========================

// Example placeholder: Replace with your actual audio loading logic.
function loadSounds() {
  // gameMusic = ...;
  // pointSound = ...;
  // crashSound = ...;
  // swooshSound = ...;
}

function playSound(sound) {
  if (userMuted) return;
  if (sound && typeof sound.play === "function") sound.play();
}

// ==========================
//   PAUSE / RESUME
// ==========================
function pauseGame() {
  // your logic for pausing the game
  pauseOverlay.style.display = "flex";
  // pause animation/game loop/etc
}

function resumeGame() {
  pauseOverlay.style.display = "none";
  // resume animation/game loop/etc
}

// Example: Bind pause/resume to events/keys
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (pauseOverlay.style.display === "flex") {
      resumeGame();
    } else {
      pauseGame();
    }
  }
});

// ==========================
//   PARALLAX / BACKGROUND FX
// ==========================

function updateParallax(delta) {
  // parallaxLayers.forEach(layer => { ... });
  // Move clouds/backgrounds based on speed and delta
}

function setupClouds() {
  // Optional: cloud element animation for home/leaderboard screens
}

// ==========================
//   MUTE / UNMUTE
// ==========================
if (muteToggleHome) {
  muteToggleHome.addEventListener("click", () => {
    userMuted = !userMuted;
    muteToggleHome.src = userMuted ? "assets/icon-mute.svg" : "assets/icon-unmute.svg";
    // Optionally mute/unmute all playing sounds
  });
}

// ==========================
//   GAME (RE)START & FLOW
// ==========================
if (startBtn) {
  startBtn.addEventListener("click", () => {
    document.getElementById("start-screen").style.display = "none";
    document.getElementById("fade-screen").style.display = "none";
    // Reset all game state, show canvas, and start play
    // ... (your existing code)
  });
}
if (homeBtn) {
  homeBtn.addEventListener("click", () => {
    location.reload();
  });
}
if (playAgainBtn) {
  playAgainBtn.addEventListener("click", () => {
    location.reload();
  });
}

// ==========================
//   GAME LOOP (TICK/FRAME)
// ==========================

function gameLoop() {
  if (isGameOver) return;
  frameCount++;
  // main update loop: move obstacles, check collisions, spawn, animate, update parallax, etc
  // ... (all your original logic here)
  updateScoreUI();
  // Request next frame
  requestAnimationFrame(gameLoop);
}

// To start the main loop:
function startGame() {
  isGameOver = false;
  points = 0;
  // ... all your game state reset logic
  updateScoreUI();
  gameLoop();
}

// ==========================
//   BOOTSTRAP
// ==========================
window.addEventListener("DOMContentLoaded", async () => {
  await getPiToken();
  // Show home screen, load best score, etc.
  // ... all your home/init logic
  // You might want to call setupParallax() or setupClouds() here
});

