import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;
const ODDS_API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";
const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

// Clean team names for consistent dictionary lookups
function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Get date string relative to today (in days offset)
function getDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

// Fetch 3 days of MLB Schedule to handle timezone crossovers
async function getMlbScheduleList() {
  try {
    const startDate = getDateStr(-1); // Yesterday
    const endDate = getDateStr(1);   // Tomorrow

    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=linescore,venue`
    );
    const data = await res.json();
    const gamesList = [];

    if (data.dates) {
      data.dates.forEach((d) => {
        if (d.games) {
          d.games.forEach((g) => {
            const normHome = normalizeName(g.teams?.home?.team?.name);
            const normAway = normalizeName(g.teams?.away?.team?.name);

            gamesList.push({
              normHome,
              normAway,
              officialDate: g.officialDate || d.date, // Store date to prevent mis-matching dates
              gamePk: g.gamePk.toString(),
              gameGuid: g.gameGuid || "N/A",
              gameType: g.gameType || "R",
              season: g.season || "2026",
              abstractState: g.status?.abstractGameState || "Preview",
              detailedState: g.status?.detailedState || "Scheduled",
              statusCode: g.status?.statusCode || "S",
              dayNight: g.dayNight || "day",
              scheduledInnings: g.scheduledInnings || 9,
              venue: g.venue || { id: 0, name: "TBD" },
              linescore: {
                currentInning: g.linescore?.currentInning || 0,
                inningHalf: g.linescore?.inningHalf || "None"
              }
            });
          });
        }
      });
    }
    return gamesList;
  } catch (err) {
    console.error("MLB Schedule Fetch Error:", err);
    return [];
  }
}

// Fetch Pitcher details helper
async function getPitcherDetails(pitcherId) {
  if (!pitcherId) return { hand: "", era: "" };
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=stats(group=pitching,type=season)`
    );
    const data = await res.json();
    const person = data.people?.[0] || {};
    const handCode = person.pitchHand?.code || "";
    const era = person.stats?.[0]?.splits?.[0]?.stat?.era || "";
    return { hand: handCode === "L" ? "LHP" : handCode === "R" ? "RHP" : "", era };
  } catch (err) {
    return { hand: "", era: "" };
  }
}

// GET /mlb Endpoint
app.get("/mlb", async (req, res) => {
  try {
    const [oddsRes, parlayRes, mlbGamesList] = await Promise.all([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`https://api.parlay-api.com/v1/mlb/historical?apiKey=${PARLAY_API_KEY}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      getMlbScheduleList()
    ]);

    const gamesByDate = {};

    oddsRes.forEach((game) => {
      const gameDateStr = game.commence_time?.split("T")[0] || getDateStr(0);
      const normHome = normalizeName(game.home_team);
      const normAway = normalizeName(game.away_team);

      // FIX BUG 1: Match by DATE in addition to team names so future games don't inherit current status
      const matchedMlb = mlbGamesList.find(
        (m) => m.officialDate === gameDateStr && (m.normHome === normHome || m.normAway === normAway)
      ) || mlbGamesList.find(
        (m) => m.normHome === normHome || m.normAway === normAway
      );

      const homeScore = game.scores?.find((s) => s.name === game.home_team)?.score || 0;
      const awayScore = game.scores?.find((s) => s.name === game.away_team)?.score || 0;

      if (!gamesByDate[gameDateStr]) gamesByDate[gameDateStr] = [];

      gamesByDate[gameDateStr].push({
        gamePk: matchedMlb?.gamePk || game.id || "000000",
        gameGuid: matchedMlb?.gameGuid || "N/A",
        gameType: matchedMlb?.gameType || "R",
        season: matchedMlb?.season || "2026",
        gameDate: game.commence_time || "",
        status: {
          abstractGameState: matchedMlb?.abstractState || (game.completed ? "Final" : "Preview"),
          detailedState: matchedMlb?.detailedState || (game.completed ? "Final" : "Scheduled"),
          statusCode: matchedMlb?.statusCode || (game.completed ? "F" : "S")
        },
        teams: {
          away: {
            score: awayScore,
            isWinner: game.completed && awayScore > homeScore,
            team: { id: game.away_team, name: game.away_team }
          },
          home: {
            score: homeScore,
            isWinner: game.completed && homeScore > awayScore,
            team: { id: game.home_team, name: game.home_team }
          }
        },
        venue: matchedMlb?.venue || { id: 0, name: `${game.home_team} Stadium` },
        dayNight: matchedMlb?.dayNight || "day",
        scheduledInnings: matchedMlb?.scheduledInnings || 9,
        linescore: matchedMlb?.linescore || { currentInning: 0, inningHalf: "None" },
        parlayData: (Array.isArray(parlayRes) ? parlayRes.find((p) => p.home_team === game.home_team) : null) || { status: "None" }
      });
    });

    res.json({
      dates: Object.keys(gamesByDate).map((d) => ({ date: d, games: gamesByDate[d] }))
    });
  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Proxy Error" });
  }
});

// GET /stats Endpoint
app.get("/stats", async (req, res) => {
  try {
    // FIX BUG 2: Expand range to 3 days to handle timezone offsets cleanly
    const startDate = getDateStr(-1);
    const endDate = getDateStr(1);

    const resMlb = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher`
    );
    const data = await resMlb.json();
    const matchups = [];

    if (data.dates) {
      for (const d of data.dates) {
        if (d.games) {
          for (const game of d.games) {
            const [home, away] = await Promise.all([
              getPitcherDetails(game.teams?.home?.probablePitcher?.id),
              getPitcherDetails(game.teams?.away?.probablePitcher?.id)
            ]);

            const homePitcherName = game.teams?.home?.probablePitcher?.fullName || "TBD";
            const awayPitcherName = game.teams?.away?.probablePitcher?.fullName || "TBD";

            matchups.push({
              gamePk: game.gamePk.toString(),
              officialDate: game.officialDate || d.date,
              // Keys matching direct table mapping
              "Stats.Home Team": game.teams?.home?.team?.name || "",
              "Stats.Away Team": game.teams?.away?.team?.name || "",
              "Stats.Home Pitcher": `${homePitcherName}${home.hand || home.era ? ` (${[home.hand, home.era].filter(Boolean).join(", ")})` : ""}`,
              "Stats.Away Pitcher": `${awayPitcherName}${away.hand || away.era ? ` (${[away.hand, away.era].filter(Boolean).join(", ")})` : ""}`,
              // Original property names fallback
              home_team: game.teams?.home?.team?.name || "",
              away_team: game.teams?.away?.team?.name || "",
              home_pitcher: `${homePitcherName}${home.hand || home.era ? ` (${[home.hand, home.era].filter(Boolean).join(", ")})` : ""}`,
              away_pitcher: `${awayPitcherName}${away.hand || away.era ? ` (${[away.hand, away.era].filter(Boolean).join(", ")})` : ""}`
            });
          }
        }
      }
    }

    res.setHeader("Content-Type", "application/json");
    res.json(matchups); // Output as array directly to simplify Apps Script mapping
  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).json({ error: "Stats Error" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
