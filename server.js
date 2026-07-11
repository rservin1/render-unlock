import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const ODDS_API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";
const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

// Normalize team names for strict matching (removes spaces, punctuation, lowercase)
function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Helper to fetch live official MLB game statuses & numeric gamePk map
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

      // Use matched numeric gamePk if found, else fallback to Odds ID
      const officialGamePk = matchedMlb ? matchedMlb.gamePk : (game.id || "000000");

      // Use live official status if matched, else fallback to score check
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
    const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=probablePitcher(person),standings,linescore`;

    const mlbRes = await fetch(mlbUrl);
    const mlbData = await mlbRes.json();

    const matchups = [];

    if (mlbData.dates && mlbData.dates.length > 0) {
      for (const dateObj of mlbData.dates) {
        for (const game of dateObj.games) {
          const homeTeam = game.teams.home;
          const awayTeam = game.teams.away;

          const homePitcher = homeTeam.probablePitcher || {};
          const awayPitcher = awayTeam.probablePitcher || {};

          const homeCode = homePitcher.pitchHand ? homePitcher.pitchHand.code : (homePitcher.person?.pitchHand?.code || "U");
          const awayCode = awayPitcher.pitchHand ? awayPitcher.pitchHand.code : (awayPitcher.person?.pitchHand?.code || "U");

          matchups.push({
            gamePk: game.gamePk.toString(),
            gameDate: game.gameDate,
            status: game.status.detailedState,
            
            home_team: homeTeam.team.name,
            home_wins: homeTeam.leagueRecord ? homeTeam.leagueRecord.wins : 0,
            home_losses: homeTeam.leagueRecord ? homeTeam.leagueRecord.losses : 0,
            home_pct: homeTeam.leagueRecord ? homeTeam.leagueRecord.pct : ".000",
            home_starter_name: homePitcher.fullName || "TBD",
            home_starter_id: homePitcher.id || null,
            home_starter_hand: homeCode === "L" ? "LHP" : (homeCode === "R" ? "RHP" : "Unknown"),

            away_team: awayTeam.team.name,
            away_wins: awayTeam.leagueRecord ? awayTeam.leagueRecord.wins : 0,
            away_losses: awayTeam.leagueRecord ? awayTeam.leagueRecord.losses : 0,
            away_pct: awayTeam.leagueRecord ? awayTeam.leagueRecord.pct : ".000",
            away_starter_name: awayPitcher.fullName || "TBD",
            away_starter_id: awayPitcher.id || null,
            away_starter_hand: awayCode === "L" ? "LHP" : (awayCode === "R" ? "RHP" : "Unknown"),

            venue: game.venue ? game.venue.name : "Unknown"
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
