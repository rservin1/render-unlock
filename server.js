import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Your specific The Odds API Key
const API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";

app.get("/mlb", async (req, res) => {
  try {
    // 1. Fetch raw data from The Odds API (v4)
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${API_KEY}&regions=us&markets=h2h,totals&oddsFormat=decimal`;
    
    const response = await fetch(url);
    const oddsData = await response.json();

    console.log("Total events received from The Odds API:", oddsData ? oddsData.length : 0);

    // Error handling if API key or request fails
    if (!Array.isArray(oddsData)) {
      return res.status(400).json({ 
        error: "Odds API Error", 
        details: oddsData 
      });
    }

    // 2. Group games by date string (YYYY-MM-DD)
    const gamesByDate = {};

    oddsData.forEach((game) => {
      // Extract YYYY-MM-DD for the top-level date grouping
      const gameDateStr = game.commence_time 
        ? game.commence_time.split("T")[0] 
        : "1970-01-01";

      // Build structured game record matching MLB Stats API schema
      const formattedGame = {
        gamePk: game.id || "000000",
        gameGuid: game.id || "",
        gameType: "R",
        season: new Date().getFullYear().toString(),
        gameDate: game.commence_time || "", // Standard ISO UTC string for Power Query DateTimeZone conversion
        dayNight: "day",
        scheduledInnings: 9,
        status: {
          abstractGameState: "Preview",
          detailedState: game.completed ? "Final" : "Scheduled",
          statusCode: game.completed ? "F" : "S"
        },
        teams: {
          away: {
            score: 0,
            isWinner: false,
            team: {
              id: game.away_team || "Away",
              name: game.away_team || "Away Team"
            }
          },
          home: {
            score: 0,
            isWinner: false,
            team: {
              id: game.home_team || "Home",
              name: game.home_team || "Home Team"
            }
          }
        },
        venue: {
          id: 0,
          name: game.home_team ? `${game.home_team} Stadium` : "MLB Venue"
        }
      };

      if (!gamesByDate[gameDateStr]) {
        gamesByDate[gameDateStr] = [];
      }
      gamesByDate[gameDateStr].push(formattedGame);
    });

    // 3. Format into root object with 'dates' array
    const formattedPayload = {
      dates: Object.keys(gamesByDate).map((dateKey) => ({
        date: dateKey,
        games: gamesByDate[dateKey]
      }))
    };

    res.json(formattedPayload);

  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ 
      error: "Proxy Failed", 
      details: error.message 
    });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
