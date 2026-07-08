import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// DK route
app.get("/dk", async (req, res) => {
  try {
    const response = await fetch(
      "https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/84240/categories/487",
      {
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch DraftKings data" });
  }
});

// MLB route
app.get("/mlb", async (req, res) => {
  try {
    const response = await fetch(
      "https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups/84240",
      {
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch MLB data" });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("DraftKings API relay is running");
});

app.listen(PORT, () => {
  console.log(`DraftKings API relay running on port ${PORT}`);
});
