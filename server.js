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

// UPDATED: Fetches linescore data from MLB API
async function getMlbScheduleMap() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=linescore`);
    const data = await res.json();
    
    const map = {};
    if (data.dates && data.dates.length > 0) {
      data.dates[0].games.forEach((g) => {
        if (g.teams && g.teams.home && g.teams.home.team) {
          const normHome = normalizeName(g.teams.home.team.name);
          map[normHome] = {
            gamePk: g.gamePk.toString(),
            abstractState: g.status.abstractGameState,
            detailedState: g.status.detailedState,
            statusCode: g.status.statusCode,
            linescore: g.linescore // Now captures the linescore object
          };
        }
      });
    }
    return map;
  } catch (err) {
    console.error("Error building MLB map:", err);
    return {};
  }
}

// ... (keep getPitcherDetails function as it is) ...

app.get("/mlb", async (req, res) => {
  try {
    // ... (keep the promise.all and data fetching logic) ...
    const [oddsRes, parlayRes, mlbMapRes] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`),
      fetch(`https://api.parlay-api.com/v1/mlb/historical?apiKey=${PARLAY_API_KEY}`),
      getMlbScheduleMap()
    ]);

    // ... (keep score parsing logic) ...

    oddsData.forEach((game) => {
      // ... (keep game date and score logic) ...

      const normHome = normalizeName(game.home_team);
      const matchedMlb = mlbMap[normHome];

      // ... (keep state variables) ...

      const formattedGame = {
        gamePk: officialGamePk,
        gameGuid: game.id || "",
        gameType: "R",
        season: new Date().getFullYear().toString(),
        gameDate: game.commence_time || "",
        dayNight: "day",
        scheduledInnings: 9,
        status: {
          abstractGameState: abstractState,
          detailedState: detailedState,
          statusCode: statusCode
        },
        teams: { /* ... */ },
        venue: { /* ... */ },
        linescore: matchedMlb ? matchedMlb.linescore : null, // ADDED: Now passes linescore to client
        parlayData: parlayInfo
      };

      // ... (keep push and response logic) ...
    });
    
    // ... (rest of the route logic) ...
  } catch (error) {
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

// ... (keep /stats endpoint and START SERVER) ...
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
