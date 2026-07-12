import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";
const PARLAY_BASE_URL = "https://api.parlay-api.com";

// Map short sport aliases to full Parlay API keys
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

// Convert UTC timestamp → MST
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

// Normalize team names for matching
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
          map[normalizeName(home)] = {
            gamePk: g.gamePk ? g.gamePk.toString() : "",
            abstractState: g.status?.abstractGameState || "Preview",
            detailedState: g.status?.detailedState || "Scheduled",
            statusCode: g.status?.statusCode || "S",
            gameDateUtc: g.gameDate
          };
        }
      });
    }
    return map;
  } catch (err) {
    console.error("MLB schedule map error:", err.message);
    return {};
  }
}

// Transform raw odds payload into normalized schema
function transformGameData(game, mlbMap = {}) {
  const homeTeam = game.home_team || "";
  const awayTeam = game.away_team || "";
  const mlb = mlbMap[normalizeName(homeTeam)] || {};

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

// Helper to handle Parlay requests
async function fetchAndTransform(endpointUrl, rawSportKey, res) {
  try {
    const sportKey = normalizeSportKey(rawSportKey);
    const oddsRes = await fetch(endpointUrl);

    if (!oddsRes.ok) {
      const errorText = await oddsRes.text();
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
    console.error("API processing error:", err.message);
    res.status(500).json({ error: "Failed to process request", details: err.message });
  }
}

// 1. Live/In-Play Points Endpoint
app.get("/mlb", (req, res) => {
  const url = `${PARLAY_BASE_URL}/v1/sports/baseball_mlb/live/points?apiKey=${PARLAY_API_KEY}`;
  fetchAndTransform(url, "baseball_mlb", res);
});

app.get("/v1/sports/:sport_key/live/points", (req, res) => {
  const sportKey = normalizeSportKey(req.params.sport_key);
  const url = `${PARLAY_BASE_URL}/v1/sports/${sportKey}/live/points?apiKey=${PARLAY_API_KEY}`;
  fetchAndTransform(url, sportKey, res);
});

// 2. Pre-game / Upcoming Odds Endpoint
app.get("/v1/sports/:sport_key/odds", (req, res) => {
  const sportKey = normalizeSportKey(req.params.sport_key);
  const url = `${PARLAY_BASE_URL}/v1/sports/${sportKey}/odds?apiKey=${PARLAY_API_KEY}&regions=us&markets=h2h,spreads,totals`;
  fetchAndTransform(url, sportKey, res);
});

// 3. SSE Stream Proxy Endpoint
app.get("/v1/sports/:sport_key/live/sse", async (req, res) => {
  const sportKey = normalizeSportKey(req.params.sport_key);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sseUrl = `${PARLAY_BASE_URL}/v1/sports/${sportKey}/live/sse?apiKey=${PARLAY_API_KEY}`;

  try {
    const upstreamRes = await fetch(sseUrl);

    if (!upstreamRes.ok) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: `Upstream error ${upstreamRes.status}` })}\n\n`);
      return res.end();
    }

    upstreamRes.body.on("data", (chunk) => res.write(chunk));
    upstreamRes.body.on("end", () => res.end());

    req.on("close", () => {
      if (upstreamRes.body.destroy) upstreamRes.body.destroy();
    });
  } catch (err) {
    console.error("SSE error:", err.message);
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
