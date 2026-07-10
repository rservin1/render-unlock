import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Use your specific The Odds API Key
const API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";

app.get("/mlb", async (req, res) => {
  try {
    // Correct URL structure for The Odds API (V4)
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${API_KEY}&regions=us&markets=h2h,totals&oddsFormat=decimal`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    // Log for verification in Render
    console.log("Total events received from The Odds API:", data ? data.length : 0);
    
    res.json(data);
  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
