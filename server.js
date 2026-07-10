import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Use your active ParlayAPI key here
const API_KEY = "74af42e4282185a2aa8618abc2889ad5";

app.get("/mlb", async (req, res) => {
  try {
    // Correct URL for ParlayAPI
    const url = `https://parlay-api.com/v1/sports/baseball_mlb/odds?apiKey=${API_KEY}&regions=us&markets=h2h,totals`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: "API Error", details: data });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
