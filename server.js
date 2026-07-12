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
    if (data.dates && data.dates.length > 0) {
      data.dates[0].games.forEach((g) => {
        if (g.teams && g.teams.home && g.teams.home.team) {
          const normHome = normalizeName(g.teams.home.team.name);
          map[normHome] = {
            gamePk: g.gamePk.toString(),
            abstractState: g.status.abstractGameState,
            detailedState: g.status.detailedState,
            statusCode: g.status.statusCode,
            linescore: g.linescore || null 
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

async function getPitcherDetails(pitcherId) {
  if (!pitcherId) return { hand: "", era: "" };
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=stats(group=pitching,type=season)`;
    const res = await fetch(url);
    const data = await res.json();
    const person = data.people?.[0] || {};
    const handCode = person.pitchHand?.code || "";
    const handStr = handCode === "L" ? "LHP" : (handCode === "R" ? "RHP" : "");
    let eraStr = "";
    const splits = person.stats?.[0]?.splits;
    if (splits && splits.length > 0 && splits[0].stat?.era) {
      eraStr = splits[0].stat.era;
    }
    return { hand: handStr, era: eraStr };
  } catch (err) {
    console.error(`Error fetching details for pitcher ${pitcherId}:`, err);
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

    let oddsData = [];
    if (oddsRes.status === "fulfilled" && oddsRes.value.ok) oddsData = await oddsRes.value.json();

    let parlayData = null;
    if (parlayRes.status === "fulfilled" && parlayRes.value.ok) parlayData = await parlayRes.value.json().catch(() => null);

    const mlbMap = mlbMapRes.status === "fulfilled" ? mlbMapRes.value : {};

    if (!Array.isArray(oddsData)) return res.status(400).json({ error: "Odds API Error" });

    const gamesByDate = {};
    oddsData.forEach((game) => {
      const gameDateStr = game.commence_time ? game.commence_time.split("T")[0] : "1970-01-01";
      const homeScore = game.scores?.find(s => s.name === game.home_team)?.score || 0;
      const awayScore = game.scores?.find(s => s.name === game.away_team)?.score || 0;
      const parlayInfo = Array.isArray(parlayData) ? parlayData.find((p) => p.home_team === game.home_team || p.id === game.id) || null : null;
      const normHome = normalizeName(game.home_team);
      const matchedMlb = mlbMap[normHome];

      const formattedGame = {
        gamePk: matchedMlb ? matchedMlb.gamePk : (game.id || "000000"),
        gameDate: game.commence_time || "",
        status: {
          abstractGameState: matchedMlb ? matchedMlb.abstractState : (game.completed ? "Final" : "Live"),
          detailedState: matchedMlb ? matchedMlb.detailedState : "In Progress",
          statusCode: matchedMlb ? matchedMlb.statusCode : "I"
        },
        teams: { away: { score: awayScore, team: { name: game.away_team } }, home: { score: homeScore, team: { name: game.home_team } } },
        linescore: matchedMlb ? matchedMlb.linescore : null,
        parlayData: parlayInfo
      };

      if (!gamesByDate[gameDateStr]) gamesByDate[gameDateStr] = [];
      gamesByDate[gameDateStr].push(formattedGame);
    });

    res.json({ dates: Object.keys(gamesByDate).map((d) => ({ date: d, games: gamesByDate[d] })) });
  } catch (error) {
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

app.get("/stats", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const mlbRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=probablePitcher`);
    const mlbData = await mlbRes.json();
    const matchups = [];

    if (mlbData.dates?.[0]?.games) {
      for (const game of mlbData.dates[0].games) {
        const [homeDetails, awayDetails] = await Promise.all([
          getPitcherDetails(game.teams?.home?.probablePitcher?.id),
          getPitcherDetails(game.teams?.away?.probablePitcher?.id)
        ]);
        matchups.push({
          gamePk: game.gamePk.toString(),
          home_team: game.teams?.home?.team?.name,
          away_team: game.teams?.away?.team?.name,
          home_pitcher: `${game.teams?.home?.probablePitcher?.fullName || "TBD"} (${[homeDetails.hand, homeDetails.era].filter(Boolean).join(", ")})`,
          away_pitcher: `${game.teams?.away?.probablePitcher?.fullName || "TBD"} (${[awayDetails.hand, awayDetails.era].filter(Boolean).join(", ")})`
        });
      }
    }
    res.json({ matchups });
  } catch (error) {
    res.status(500).json({ error: "Stats Failed" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
