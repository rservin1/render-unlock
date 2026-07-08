import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// MLB route using REAL DraftKings API
app.get("/mlb", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.draftkings.com/sites/US-SB/api/v5/eventgroups/842/markets"
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch MLB data" });
  }
});

// DK route (optional)
app.get("/dk", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.draftkings.com/sites/US-SB/api/v5/eventgroups/842/categories"
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch DraftKings data" });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("DraftKings API relay is running");
});

app.listen(PORT, () => {
  console.log(`DraftKings API relay running on port ${PORT}`);
});
