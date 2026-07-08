import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// MLB route using MLB Stats API (works on Render)
app.get("/mlb", async (req, res) => {
  try {
    const response = await fetch(
      "https://statsapi.mlb.com/api/v1/schedule?sportId=1"
    );
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch MLB data" });
  }
});

// Root route
app.get("/", (req, res) => {
  res.send("MLB Stats API relay is running");
});

app.listen(PORT, () => {
  console.log(`MLB API relay running on port ${PORT}`);
});
