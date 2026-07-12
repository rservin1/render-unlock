import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const ODDS_API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";
const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function getMlbScheduleMap() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=linescore`);
    const data = await res.json();
    const map = {};
    if (data.dates?.[0]?.games) {
      data.dates[0].games.forEach((g) => {
        const normHome = normalizeName(g.teams?.home?.team?.name);
        map[normHome] = {
          gamePk: g.gamePk.toString(),
          abstractState: g.status.abstractGameState,
          detailedState: g.status.detailedState,
          statusCode: g.status.statusCode,
          // Explicitly structure linescore object
          linescore: {
            currentInning: g.linescore?.currentInning || 0,
            inningHalf: g.linescore?.inningHalf || "None"
          }
        };
      });
    }
    return map;
  } catch (err) {
    console.error("Error building MLB map:", err);
    return {};
  }
}

// ... getPitcherDetails function remains the same ...

app.get("/mlb", async (req, res) => {
  try {
    const [oddsRes, parlayRes, mlbMapRes] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`),
      fetch(`https://api.parlay-api.com/v1/mlb/historical?apiKey=${PARLAY_API_KEY}`),
      getMlbScheduleMap()
    ]);

    let oddsData = oddsRes.status === "fulfilled" && oddsRes.value.ok ? await oddsRes.value.json() : [];
    let parlayData = parlayRes.status === "fulfilled" && parlayRes.value.ok ? await parlayRes.value.json().catch(() => null) : null;
    const mlbMap = mlbMapRes.status === "fulfilled" ? mlbMapRes.value : {};

    const gamesByDate = {};
    oddsData.forEach((game) => {
      const gameDateStr = game.commence_time?.split("T")[0] || "1970-01-01";
      const normHome = normalizeName(game.home_team);
      const matchedMlb = mlbMap[normHome];

      const formattedGame = {
        gamePk: matchedMlb?.gamePk || game.id || "000000",
        gameDate: game.commence_time || "",
        status: {
          abstractGameState: matchedMlb?.abstractState || (game.completed ? "Final" : "Live"),
          detailedState: matchedMlb?.detailedState || "In Progress",
          statusCode: matchedMlb?.statusCode || "I"
        },
        teams: { 
          away: { score: game.scores?.find(s => s.name === game.away_team)?.score || 0, team: { name: game.away_team } }, 
          home: { score: game.scores?.find(s => s.name === game.home_team)?.score || 0, team: { name: game.home_team } } 
        },
        // Ensure linescore is always an object, even if empty
        linescore: matchedMlb?.linescore || { currentInning: 0, inningHalf: "None" },
        // Ensure parlayData is always an object
        parlayData: (Array.isArray(parlayData) ? parlayData.find((p) => p.home_team === game.home_team) : null) || { status: "None" }
      };

      if (!gamesByDate[gameDateStr]) gamesByDate[gameDateStr] = [];
      gamesByDate[gameDateStr].push(formattedGame);
    });

    res.json({ dates: Object.keys(gamesByDate).map((d) => ({ date: d, games: gamesByDate[d] })) });
  } catch (error) {
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

// ... (stats endpoint and app.listen remain the same)
