// Helper to map short sport aliases to Parlay API keys
function normalizeSportKey(key) {
  const map = {
    mlb: "baseball_mlb",
    nba: "basketball_nba",
    nfl: "americanfootball_nfl",
    nhl: "icehockey_nhl"
  };
  return map[key.toLowerCase()] || key;
}

const handleLivePoints = async (req, res) => {
  try {
    // 1. Map incoming key (e.g. "mlb" -> "baseball_mlb")
    const rawKey = req.params.sport_key || "baseball_mlb";
    const sportKey = normalizeSportKey(rawKey);

    // 2. Fetch Live Points from Parlay API
    const oddsUrl = `${PARLAY_BASE_URL}/v1/sports/${sportKey}/live/points?apiKey=${PARLAY_API_KEY}`;
    const oddsRes = await fetch(oddsUrl);

    if (!oddsRes.ok) {
      const errorText = await oddsRes.text();
      console.error(`Parlay API Error (${oddsRes.status}):`, errorText);
      return res.status(oddsRes.status).json({ 
        error: `Parlay API error (${oddsRes.status})`, 
        details: errorText 
      });
    }

    const oddsJson = await oddsRes.json();

    // 3. Fetch MLB map only if querying MLB
    const mlbMap = sportKey.includes("mlb") ? await getMlbScheduleMap() : {};

    const gamesByDate = {};

    oddsJson.forEach((game) => {
      const dateStr = game.commence_time.split("T")[0];
      const formattedGame = transformGameData(game, mlbMap);

      if (!gamesByDate[dateStr]) gamesByDate[dateStr] = [];
      gamesByDate[dateStr].push(formattedGame);
    });

    res.json({
      dates: Object.keys(gamesByDate).map((d) => ({
        date: d,
        games: gamesByDate[d]
      }))
    });
  } catch (err) {
    console.error("Live points endpoint error:", err);
    res.status(500).json({ error: "Failed to fetch live points data", details: err.message });
  }
};
