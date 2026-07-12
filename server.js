import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

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

// ===============================
// MAIN ENDPOINT: /mlb
// ===============================
app.get("/mlb", async (req, res) => {
  try {
    // 1. LIVE ODDS (DraftKings + MGM only)
    const oddsUrl = `https://api.parlay-api.com/v1/sports/baseball_mlb/live/points?apiKey=${PARLAY_API_KEY}`;
    const oddsRes = await fetch(oddsUrl);
    const oddsJson = await oddsRes.json();

    // 2. MLB schedule map
    const mlbMap = await getMlbScheduleMap();

    const gamesByDate = {};

    oddsJson.forEach((game) => {
      const dateStr = game.commence_time.split("T")[0];

      const homeTeam = game.home_team;
      const awayTeam = game.away_team;

      const normHome = normalizeName(homeTeam);
      const mlb = mlbMap[normHome] || {};

      // Extract ONLY MGM + DraftKings
      let dk = null;
      let mgm = null;

      if (Array.isArray(game.bookmakers)) {
        game.bookmakers.forEach((bk) => {
          const key = bk.key.toLowerCase();

          if (key.includes("draftkings")) dk = bk;
          if (key.includes("betmgm") || key.includes("mgm")) mgm = bk;
        });
      }

      // Extract markets
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

      const formattedGame = {
        gamePk: mlb.gamePk || game.id || "",
        gameGuid: game.id || "",
        gameType: "R",
        season: new Date().getFullYear().toString(),
        gameDate: game.comm
