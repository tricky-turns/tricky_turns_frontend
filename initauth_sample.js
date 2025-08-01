async function initAuth() {
  // Show the auth loading spinner
  authLoading.classList.remove('hidden');
  usernameLabel.classList.add('hidden');
  loginBtn.classList.add('hidden');

  piUsername = '';
  piToken = null;
  useLocalHighScore = true;

  // Always fetch available modes first!
  await fetchGameModes();

  // Try Pi authentication
  let loginSuccess = false;
  try {
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
    // Pi Browser, but auth failed or cancelled (fallback to guest)
    loginSuccess = false;
  }

  // --- Load best scores for all modes ---
  allBestScores = {};
  if (loginSuccess && piToken) {
    // Authenticated: fetch from API
    for (const mode of availableModes) {
      try {
        const res = await fetch(`${BACKEND_BASE}/api/leaderboard/me?mode_id=${mode.id}`, {
          headers: { Authorization: `Bearer ${piToken}` }
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

  // Set selectedModeId to Classic (or first mode) if not set
  if (!selectedModeId) {
    selectedModeId =
      availableModes.find(m => m.name.toLowerCase() === 'classic')?.id ||
      availableModes[0]?.id ||
      1;
  }

  // Set initial highScore for selected mode
  highScore = allBestScores[selectedModeId] || 0;
  updateBestScoreEverywhere();

  // ---- SHOW UI: This is the CRITICAL part! ----
  userInfo.classList.remove('hidden');              // Make sure user info is visible!
  authLoading.classList.add('hidden');              // Hide spinner
  usernameLabel.innerText = piUsername || 'Guest';  // Show name
  usernameLabel.classList.remove('hidden');
  loginBtn.classList.remove('hidden');
  startScreen.classList.add('ready');

  // (Optional) Debug message
  showDebug(
    useLocalHighScore
      ? "Guest mode: loaded highScores from localStorage"
      : `Logged in as @${piUsername}: loaded highScores from API`
  );
}