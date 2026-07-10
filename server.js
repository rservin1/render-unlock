import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// Your ParlayAPI key
const API_KEY = "74af42e4282185a2aa8618abc2889ad5";

// MLB odds relay (ParlayAPI → Render → Power Query)
app.get("/mlb", async (req, res) => {
  try {
    const url =
      "https://api.parlay-api.com/v1/sports/baseball_mlb/odds" +
      `?apiKey=${API_KEY}` +
      "&regions=us" +
      "&markets=h2h,spreads,alternate_spreads,alternate_totals";

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({
        error: `ParlayAPI error ${response.status}`,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch MLB odds",
      details: error.message,
    });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("MLB Odds API relay is running");
});

// Render port binding
app.listen(PORT, () => {
  console.log(`MLB Odds API relay running on port ${PORT}`);
});
