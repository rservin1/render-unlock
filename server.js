import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Your API key
const API_KEY = "74af42e4282185a2aa8618abc2889ad5";

// MLB odds relay
app.get("/mlb", async (req, res) => {
  try {
    // Correct URL structure for The Odds API v4
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${API_KEY}&regions=us&markets=h2h,totals`;
    
    console.log("Fetching from:", url); // This helps debug in Render logs

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: `API error ${response.status}`,
        details: data,
      });
    }

    // Power Query handles flat arrays best
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch MLB odds",
      details: error.message,
    });
  }
});

app.get("/", (req, res) => {
  res.send("MLB Odds API relay is running");
});

app.listen(PORT, () => {
  console.log(`MLB Odds API relay running on port ${PORT}`);
});
