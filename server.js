import express from "express";
import fetch from "node-fetch";

const app = express();

app.get("/dk", async (req, res) => {
  try {
    const response = await fetch("https://sportsbook.draftkings.com//sites/US-SB/api/v5/eventgroups/84240/categories/487");
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch DraftKings data" });
  }
});

app.listen(3000, () => {
  console.log("DraftKings API relay running on port 3000");
});
