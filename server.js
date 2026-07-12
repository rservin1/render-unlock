const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";
const PARLAY_BASE_URL = "https://api.parlay-api.com";

// Helper to map short sport aliases to Parlay API keys
function normalizeSportKey(key) {
  if (!key) return "baseball_mlb";
  const map = {
    mlb: "baseball_mlb",
    nba: "basketball_nba",
    nfl: "americanfootball_nfl",
    nhl: "icehockey_nhl"
  };
  return map[key.toLowerCase()] || key;
}

// Convert UTC → MST
function formatToMST(utcString, timeOnly = false) {
  if (!utcString) return "";
  const dateObj = new Date(utcString);
  if (isNaN(dateObj.getTime())) return "";

  const options = timeOnly
    ? {
        timeZone: "America/Phoenix",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short"
      }
    : {
        timeZone: "America/Phoenix",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short"
      };

  return dateObj.toLocaleString("en-US", options);
}

// Normalize team names
function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Fetch official MLB schedule map
async function getMlbScheduleMap() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}`
    );
    const data = await res.json();

    const map = {};
    if (data.dates?.length > 0) {
      data.dates[0].games.forEach((g) => {
        const home = g.teams?.home?.team?.name;
        if (home) {
          const norm = normalizeName(home);
          map[norm] = {
            gamePk: g.gamePk.toString(),
            abstractState: g.status.abstractGameState,
            detailedState: g.status.detailedState,
            statusCode: g.status.statusCode,
            gameDateUtc: g.gameDate
          };
        }
      });
    }
    return map;
  } catch (err) {
    console.error("MLB map error:", err);
    return {};
  }
}

// Extract markets and build clean game object
function transformGameData(game, mlbMap = {}) {
  const homeTeam = game.home_team;
  const awayTeam = game.away_team;

  const normHome = normalizeName(homeTeam);
  const mlb = mlbMap[normHome] || {};

  let dk = null;
  let mgm = null;

  if (Array.isArray(game.bookmakers)) {
    game.bookmakers.forEach((bk) => {
      const key = bk.key ? bk.key.toLowerCase() : "";
      if (key.includes("draftkings")) dk = bk;
      if (key.includes("betmgm") || key.includes("mgm")) mgm = bk;
    });
  }

  const extractMarkets = (book) => {
    if (!book || !Array.isArray(book.markets)) return {};

    const ml = book.markets.find((m) => m.key === "h2h");
    const spread = book.markets.find((m) => m.key === "spreads");
    const totals = book.markets.find((m) => m.key === "totals");

    return {
      mlAway: ml?.outcomes?.find((o) => o.name === awayTeam)?.price ?? null,
      mlHome: ml?.outcomes?.find((o) => o.name === homeTeam)?.price ?? null,
      spreadAway: spread?.outcomes?.find((o) => o.name === awayTeam)?.point ?? null,
      spreadHome: spread?.outcomes?.find((o) => o.name === homeTeam)?.point ?? null,
      totalOver: totals?.outcomes?.find((o) => o.name === "Over")?.point ?? null,
      totalUnder: totals?.outcomes?.find((o) => o.name === "Under")?.point ?? null
    };
  };

  const dkData = extractMarkets(dk);
  const mgmData = extractMarkets(mgm);

  return {
    gamePk: mlb.gamePk || game.id || "",
    gameGuid: game.id || "",
    gameType: "R",
    season: new Date().getFullYear().toString(),
    gameDate: game.commence_time,
    gameDateMST: formatToMST(game.commence_time),
    gameTimeMST: formatToMST(game.commence_time, true),

    status: {
      abstractGameState: mlb.abstractState || "Preview",
      detailedState: mlb.detailedState || "Scheduled",
      statusCode: mlb.statusCode || "S"
    },

    teams: {
      away: {
        score: 0,
        isWinner: false,
        team: { id: awayTeam, name: awayTeam }
      },
      home: {
        score: 0,
        isWinner: false,
        team: { id: homeTeam, name: homeTeam }
      }
    },

    venue: {
      id: 0,
      name: `${homeTeam} Stadium`
    },

    parlayData: {
      draftkings_ml_away: dkData.mlAway,
      draftkings_ml_home: dkData.mlHome,
      draftkings_spread_away: dkData.spreadAway,
      draftkings_spread_home: dkData.spreadHome,
      draftkings_total_over: dkData.totalOver,
      draftkings_total_under: dkData.totalUnder,

      mgm_ml_away: mgmData.mlAway,
      mgm_ml_home: mgmData.mlHome,
      mgm_spread_away: mgmData.spreadAway,
      mgm_spread_home: mgmData.spreadHome,
      mgm_total_over: mgmData.totalOver,
      mgm_total_under: mgmData.totalUnder
    }
  };
}

// Handler for Live Points Snapshot
const handleLivePoints = async (req, res) => {
  try {
    const rawKey = req.params.sport_key || "baseball_mlb";
    const sportKey = normalizeSportKey(rawKey);

    const oddsUrl = `${PARLAY_BASE_URL}/v1/sports/${sportKey}/live/points?apiKey=${PARLAY_API_KEY}`;
    const oddsRes = await fetch(oddsUrl);

    if (!oddsRes.ok) {
      const errorText = await oddsRes.text();
      console.error(`Parlay API error (${oddsRes.status}):`, errorText);
      return res.status(oddsRes.status).json({
        error: `Parlay API error (${oddsRes.status})`,
        details: errorText
      });
    }

    const oddsJson = await oddsRes.json();
    const mlbMap = sportKey.includes("mlb") ? await getMlbScheduleMap() : {};
    const gamesByDate = {};

    if (Array.isArray(oddsJson)) {
      oddsJson.forEach((game) => {
        const dateStr = game.commence_time ? game.commence_time.split("T")[0] : "Unknown";
        const formattedGame = transformGameData(game, mlbMap);

        if (!gamesByDate[dateStr]) gamesByDate[dateStr] = [];
        gamesByDate[dateStr].push(formattedGame);
      });
    }

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

// Endpoints
app.get("/mlb", handleLivePoints);
app.get("/v1/sports/:sport_key/live/points", handleLivePoints);

// SSE Streaming Endpoint
app.get("/v1/sports/:sport_key/live/sse", async (req, res) => {
  const rawKey = req.params.sport_key || "baseball_mlb";
  const sportKey = normalizeSportKey(rawKey);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (res.flushHeaders) res.flushHeaders();

  const sseUrl = `${PARLAY_BASE_URL}/v1/sports/${sportKey}/live/sse?apiKey=${PARLAY_API_KEY}`;

  try {
    const upstreamRes = await fetch(sseUrl);

    if (!upstreamRes.ok) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Failed to connect to upstream stream" })}\n\n`);
      return res.end();
    }

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();

    const readChunk = async () => {
      try {
        const { done, value } = await reader.read();
        if (done) return res.end();
        res.write(decoder.decode(value, { stream: true }));
        readChunk();
      } catch (streamErr) {
        res.end();
      }
    };

    readChunk();

    req.on("close", () => {
      reader.cancel().catch(() => {});
    });
  } catch (err) {
    console.error("SSE error:", err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
