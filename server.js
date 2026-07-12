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
          linescore: {
            currentInning: g.linescore?.currentInning || 0,
            inningHalf: g.linescore?.inningHalf || "None"
          }
        };
      });
    }
    return map;
  } catch (err) {
    console.error("Error in getMlbScheduleMap:", err);
    return {};
  }
}

async function getPitcherDetails(pitcherId) {
  if (!pitcherId) return { hand: "", era: "" };
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=stats(group=pitching,type=season)`);
    const data = await res.json();
    const person = data.people?.[0] || {};
    const handCode = person.pitchHand?.code || "";
    const era = person.stats?.[0]?.splits?.[0]?.stat?.era || "";
    return { hand: handCode === "L" ? "LHP" : (handCode === "R" ? "RHP" : ""), era: era };
  } catch (err) {
    return { hand: "", era: "" };
  }
}

app.get("/mlb", async (req, res) => {
  try {
    const [oddsRes, parlayRes, mlbMapRes] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`),
      fetch(`https://api.parlay-api.com/v1/mlb/historical?apiKey=${PARLAY_API_KEY}`),
      getMlbScheduleMap()
    ]);

    const oddsData = oddsRes.status === "fulfilled" && oddsRes.value.ok ? await oddsRes.value.json() : [];
    const parlayData = parlayRes.status === "fulfilled" && parlayRes.value.ok ? await parlayRes.value.json().catch(() => null) : null;
    const mlbMap = mlbMapRes.status === "fulfilled" ? mlbMapRes.value : {};

    const gamesByDate = {};
    oddsData.forEach((game) => {
      const gameDateStr = game.commence_time?.split("T")[0] || "1970-01-01";
      const normHome = normalizeName(game.home_team);
      const matchedMlb = mlbMap[normHome];

      if (!gamesByDate[gameDateStr]) gamesByDate[gameDateStr] = [];
      
      gamesByDate[gameDateStr].push({
        gamePk: matchedMlb?.gamePk || game.id || "000000",
        gameDate: game.commence_time || "",
        status: {
          abstractGameState: matchedMlb?.abstractState || "Preview",
          detailedState: matchedMlb?.detailedState || "Scheduled",
          statusCode: matchedMlb?.statusCode || "S"
        },
        teams: { 
          away: { score: game.scores?.find(s => s.name === game.away_team)?.score || 0, team: { name: game.away_team } }, 
          home: { score: game.scores?.find(s => s.name === game.home_team)?.score || 0, team: { name: game.home_team } } 
        },
        linescore: matchedMlb?.linescore || { currentInning: 0, inningHalf: "None" },
        parlayData: (Array.isArray(parlayData) ? parlayData.find((p) => p.home_team === game.home_team) : null) || { status: "None" }
      });
    });

    res.json({ dates: Object.keys(gamesByDate).map((d) => ({ date: d, games: gamesByDate[d] })) });
  } catch (error) {
    res.status(500).json({ error: "Proxy Error" });
  }
});

app.get("/stats", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const resMlb = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=probablePitcher`);
    const data = await resMlb.json();
    const matchups = [];
    if (data.dates?.[0]?.games) {
      for (const game of data.dates[0].games) {
        const [home, away] = await Promise.all([
          getPitcherDetails(game.teams?.home?.probablePitcher?.id),
          getPitcherDetails(game.teams?.away?.probablePitcher?.id)
        ]);
        matchups.push({
          gamePk: game.gamePk.toString(),
          home_team: game.teams?.home?.team?.name,
          away_team: game.teams?.away?.team?.name,
          home_pitcher: `${game.teams?.home?.probablePitcher?.fullName || "TBD"} (${[home.hand, home.era].filter(Boolean).join(", ")})`,
          away_pitcher: `${game.teams?.away?.probablePitcher?.fullName || "TBD"} (${[away.hand, away.era].filter(Boolean).join(", ")})`
        });
      }
    }
    res.json({ matchups });
  } catch (error) {
    res.status(500).json({ error: "Stats Error" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
