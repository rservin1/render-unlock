import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// Use your active ParlayAPI key here
const API_KEY = "74af42e4282185a2aa8618abc2889ad5";

app.get("/mlb", async (req, res) => {
  try {
    // We remove the limit or specific market filters if they were hiding games
    // Update this line inside your app.get("/mlb", ...) block
const url = `https://parlay-api.com/v1/sports/baseball_mlb/odds?apiKey=${API_KEY}&regions=us&markets=h2h,totals`;
    
    console.log("--- DEBUGGING API CALL ---");
    const response = await fetch(url);
    const data = await response.json();
    
    // DEBUG: Log the count to your Render logs
    console.log("Total games successfully fetched from API:", data ? data.length : 0);
    console.log("--- END DEBUG ---");

    if (!response.ok) {
      return res.status(response.status).json({ error: "API Error", details: data });
    }
    res.json(data);
  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
