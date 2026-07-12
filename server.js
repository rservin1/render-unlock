import express from "express";
import fetch from "node-fetch";

// 1. INITIALIZE EXPRESS FIRST
const app = express();
const PORT = process.env.PORT || 10000;

const ODDS_API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";
const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

// Helper: Normalize team names
function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Helper: Fetch live official MLB game statuses & gamePk map
async function getMlbScheduleMap() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}`);
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
            statusCode: g.status.statusCode
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

// Helper: Fetch Pitcher Hand and ERA
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

// ==========================================
// ENDPOINT 1: LIVE SCORES & ODDS (/mlb)
// ==========================================
app.get("/mlb", async (req, res) => {
  try {
    const [oddsRes, parlayRes, mlbMapRes] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`),
      fetch(`https://api.parlay-api.com/v1/mlb/historical?apiKey=${PARLAY_API_KEY}`),
      getMlbScheduleMap()
    ]);

    let oddsData = [];
    if (oddsRes.status === "fulfilled" && oddsRes.value.ok) {
      oddsData = await oddsRes.value.json();
    }

    let parlayData = null;
    if (parlayRes.status === "fulfilled" && parlayRes.value.ok) {
      parlayData = await parlayRes.value.json().catch(() => null);
    }

    const mlbMap = mlbMapRes.status === "fulfilled" ? mlbMapRes.value : {};

    if (!Array.isArray(oddsData)) {
      return res.status(400).json({ error: "Odds API Error", details: oddsData });
    }

    const gamesByDate = {};

    oddsData.forEach((game) => {
      const gameDateStr = game.commence_time 
        ? game.commence_time.split("T")[0] 
        : "1970-01-01";

      let homeScore = 0;
      let awayScore = 0;

      if (Array.isArray(game.scores)) {
        const homeObj = game.scores.find((s) => s.name === game.home_team);
        const awayObj = game.scores.find((s) => s.name === game.away_team);

        if (homeObj && homeObj.score !== undefined) homeScore = parseInt(homeObj.score, 10) || 0;
        if (awayObj && awayObj.score !== undefined) awayScore = parseInt(awayObj.score, 10) || 0;
      }

      const homeWinner = game.completed && homeScore > awayScore;
      const awayWinner = game.completed && awayScore > homeScore;

      const parlayInfo = Array.isArray(parlayData) 
        ? parlayData.find((p) => p.home_team === game.home_team || p.id === game.id) || null
        : null;

      const normHome = normalizeName(game.home_team);
      const matchedMlb = mlbMap[normHome];

      const officialGamePk = matchedMlb ? matchedMlb.gamePk : (game.id || "000000");
      const abstractState = matchedMlb ? matchedMlb.abstractState : (game.completed ? "Final" : (game.scores ? "Live" : "Preview"));
      const detailedState = matchedMlb ? matchedMlb.detailedState : (game.completed ? "Final" : (game.scores ? "In Progress" : "Scheduled"));
      const statusCode = matchedMlb ? matchedMlb.statusCode : (game.completed ? "F" : (game.scores ? "I" : "S"));

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
        teams: {
          away: {
            score: awayScore,
            isWinner: awayWinner,
            team: {
              id: game.away_team || "Away",
              name: game.away_team ? game.away_team.trim() : "Away Team"
            }
          },
          home: {
            score: homeScore,
            isWinner: homeWinner,
            team: {
              id: game.home_team || "Home",
              name: game.home_team ? game.home_team.trim() : "Home Team"
            }
          }
        },
        venue: {
          id: 0,
          name: game.home_team ? `${game.home_team.trim()} Stadium` : "MLB Venue"
        },
        parlayData: parlayInfo
      };

      if (!gamesByDate[gameDateStr]) {
        gamesByDate[gameDateStr] = [];
      }
      gamesByDate[gameDateStr].push(formattedGame);
    });

    res.json({
      dates: Object.keys(gamesByDate).map((dateKey) => ({
        date: dateKey,
        games: gamesByDate[dateKey]
      }))
    });

  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

// ==========================================
// ENDPOINT 2: HISTORICAL TRENDS & MATCHUPS (/stats)
// ==========================================
app.get("/stats", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=probablePitcher`;

    const mlbRes = await fetch(mlbUrl);
    const mlbData = await mlbRes.json();

    const matchups = [];

    if (mlbData.dates && mlbData.dates.length > 0) {
      for (const dateObj of mlbData.dates) {
        for (const game of dateObj.games) {
          const homeTeam = game.teams?.home || {};
          const awayTeam = game.teams?.away || {};

          const homePitcherRaw = homeTeam.probablePitcher || {};
          const awayPitcherRaw = awayTeam.probablePitcher || {};

          // Fetch Hand and ERA in parallel
          const [homeDetails, awayDetails] = await Promise.all([
            getPitcherDetails(homePitcherRaw.id),
            getPitcherDetails(awayPitcherRaw.id)
          ]);

          // Team Strings: "Kansas City Royals (36-54)"
          const homeWins = homeTeam.leagueRecord?.wins ?? 0;
          const homeLosses = homeTeam.leagueRecord?.losses ?? 0;
          const awayWins = awayTeam.leagueRecord?.wins ?? 0;
          const awayLosses = awayTeam.leagueRecord?.losses ?? 0;

          const homeTeamFormatted = `${homeTeam.team?.name || "Home"} (${homeWins}-${homeLosses})`;
          const awayTeamFormatted = `${awayTeam.team?.name || "Away"} (${awayWins}-${awayLosses})`;

          // Pitcher Strings: "Noah Cameron (LHP, 5.04)"
          let homePitcherFormatted = homePitcherRaw.fullName || "TBD";
          if (homePitcherRaw.fullName) {
            const extra = [homeDetails.hand, homeDetails.era].filter(Boolean).join(", ");
            if (extra) homePitcherFormatted = `${homePitcherRaw.fullName} (${extra})`;
          }

          let awayPitcherFormatted = awayPitcherRaw.fullName || "TBD";
          if (awayPitcherRaw.fullName) {
            const extra = [awayDetails.hand, awayDetails.era].filter(Boolean).join(", ");
            if (extra) awayPitcherFormatted = `${awayPitcherRaw.fullName} (${extra})`;
          }

          matchups.push({
            gamePk: game.gamePk.toString(),
            home_team: homeTeamFormatted,
            away_team: awayTeamFormatted,
            home_pitcher: homePitcherFormatted,
            away_pitcher: awayPitcherFormatted
          });
        }
      }
    }

    res.json({ matchups });

  } catch (error) {
    console.error("Stats Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch stats", details: error.message });
  }
});

// START SERVER
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
