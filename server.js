import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// API Keys
const ODDS_API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";
const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

app.get("/mlb", async (req, res) => {
  try {
    // Fetch Odds API, ParlayAPI, and official MLB Stats API concurrently
    const [oddsRes, parlayRes, mlbRes] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`),
      fetch(`https://api.parlay-api.com/v1/mlb/historical?apiKey=${PARLAY_API_KEY}`),
      fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=probablePitcher,standings`)
    ]);

    // Parse Odds API Payload
    let oddsData = [];
    if (oddsRes.status === "fulfilled" && oddsRes.value.ok) {
      oddsData = await oddsRes.value.json();
    }

    // Parse ParlayAPI Payload
    let parlayData = null;
    if (parlayRes.status === "fulfilled" && parlayRes.value.ok) {
      parlayData = await parlayRes.value.json().catch(() => null);
    }

    // Parse Official MLB Stats API Payload (Probable Pitchers & Standings)
    let mlbData = null;
    if (mlbRes.status === "fulfilled" && mlbRes.value.ok) {
      mlbData = await mlbRes.value.json().catch(() => null);
    }

    if (!Array.isArray(oddsData)) {
      return res.status(400).json({ error: "Odds API Error", details: oddsData });
    }

    const gamesByDate = {};

    oddsData.forEach((game) => {
      const gameDateStr = game.commence_time 
        ? game.commence_time.split("T")[0] 
        : "1970-01-01";

      // Parse Live/Completed Scores
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

      // Extract matching ParlayAPI data
      const parlayInfo = Array.isArray(parlayData) 
        ? parlayData.find(p => p.home_team === game.home_team || p.id === game.id) || null
        : null;

      // Build Game Record
      const formattedGame = {
        gamePk: game.id || "000000",
        gameGuid: game.id || "",
        gameType: "R",
        season: new Date().getFullYear().toString(),
        gameDate: game.commence_time || "",
        dayNight: "day",
        scheduledInnings: 9,
        status: {
          abstractGameState: game.completed ? "Final" : (game.scores ? "Live" : "Preview"),
          detailedState: game.completed ? "Final" : (game.scores ? "In Progress" : "Scheduled"),
          statusCode: game.completed ? "F" : (game.scores ? "I" : "S")
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
          name: game.home_team ? `${game.home_team} Stadium` : "MLB Venue"
        },
        parlayData: parlayInfo
      };

      if (!gamesByDate[gameDateStr]) {
        gamesByDate[gameDateStr] = [];
      }
      gamesByDate[gameDateStr].push(formattedGame);
    });

    const formattedPayload = {
      dates: Object.keys(gamesByDate).map((dateKey) => ({
        date: dateKey,
        games: gamesByDate[dateKey]
      }))
    };

    res.json(formattedPayload);

  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
