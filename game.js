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

// ==========================
//     SCORE & RANK LOGIC
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

// ==========================
//     GAME OVER DISPLAY
// ==========================

async function showLeaderboard(playerScore = null) {
  const leaderboardEl = document.getElementById("leaderboard");
  leaderboardEl.innerHTML = "<p>Loading leaderboard...</p>";
  leaderboardEl.style.display = "block";

  try {
    const [topScores, myScore, myRank] = await Promise.all([
      getTopScores(),
      getMyScore(),
      getMyRank()
    ]);

    let html = `<h2>🏆 Leaderboard</h2><ul>`;
    topScores.forEach((entry, i) => {
      html += `
        <li>
          <span class="rank">${i + 1}</span>
          <span class="user">${entry.username}</span>
          <span class="score">${entry.score}</span>
        </li>`;
    });
    html += `</ul>`;

    if (myScore) {
      html += `<p>Your Best Score: ${myScore.score}</p>`;
    }
    if (myRank) {
      html += `<p>Your Global Rank: ${myRank.rank}</p>`;
    }

    leaderboardEl.innerHTML = html;
  } catch (err) {
    leaderboardEl.innerHTML = `<p>⚠️ Could not load leaderboard.</p>`;
  }
}

// ==========================
//     GAME ENTRY POINT
// ==========================

window.addEventListener("load", async () => {
  await getPiToken();
  initializeGame();
});

// ==========================
//     CORE GAME HOOKS
// ==========================

function initializeGame() {
  console.log("🎮 Game Initialized");
  // Place your game engine init here
}

function onGameOver(finalScore) {
  console.log(`💀 Game Over - Final Score: ${finalScore}`);
  submitScore(finalScore);
  showLeaderboard(finalScore);
}

// ==========================
//     UI BUTTON SETUP
// ==========================

function setupUI() {
  const closeBtn = document.getElementById("closeLeaderboard");
  const leaderboardBtn = document.getElementById("viewLeaderboard");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      document.getElementById("leaderboard").style.display = "none";
    });
  }

  if (leaderboardBtn) {
    leaderboardBtn.addEventListener("click", () => {
      showLeaderboard();
    });
  }
}

setupUI();
