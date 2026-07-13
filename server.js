import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const ODDS_API_KEY = "ca033d2296b68d852fb18bd999cd8f9f";
const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

// ===============================
// PITCHER ID MAP (Your Approved List)
// ===============================
const pitcherMap = {
  "Pittsburgh Pirates": 694973,
  "Milwaukee Brewers": 688107,
  "Baltimore Orioles": 669358,
  "Kansas City Royals": 607625,
  "Washington Nationals": 676917,
  "New York Yankees": 701540,
  "Cincinnati Reds": 671096,
  "Chicago Cubs": 575110,
  "New York Mets": 804267,
  "Boston Red Sox": 801139,
  "Tampa Bay Rays": 693855,
  "Seattle Mariners": 671066,
  "Detroit Tigers": 669373,
  "Philadelphia Phillies": 554430,
  "Miami Marlins": 663969,
  "Cleveland Guardians": 676282,
  "Minnesota Twins": 671737,
  "Los Angeles Angels": 667755,
  "Chicago White Sox": 702273,
  "Athletics": 669372,
  "St. Louis Cardinals": 669610,
  "Atlanta Braves": 669372,
  "Texas Rangers": 669022,
  "Houston Astros": 664299,
  "San Francisco Giants": 686790,
  "Colorado Rockies": 547179,
  "Los Angeles Dodgers": 686218,
  "Arizona Diamondbacks": 683352,
  "San Diego Padres": 608566,
  "Toronto Blue Jays": 592332
};

// ===============================
// Helper: Hydrate Pitcher Stats
// ===============================
async function getPitcherDetails(pitcherId) {
  if (!pitcherId) {
    return {
      fullName: "TBD",
      hand: "",
      era: "",
      eraLHB: "",
      eraRHB: ""
    };
  }

  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=stats(group=pitching,type=season)`;
    const res = await fetch(url);
    const data = await res.json();

    const person = data.people?.[0] || {};
    const fullName = person.fullName || "TBD";

    const handCode = person.pitchHand?.code || "";
    const hand = handCode === "L" ? "LHP" : handCode === "R" ? "RHP" : "";

    let era = "";
    let eraLHB = "";
    let eraRHB = "";

    const splits = person.stats?.[0]?.splits || [];
    if (splits.length > 0) {
      const stat = splits[0].stat || {};
      era = stat.era || "";
      eraLHB = stat.eraVsLeft || stat.eraLeft || "";
      eraRHB = stat.eraVsRight || stat.eraRight || "";
    }

    return { fullName, hand, era, eraLHB, eraRHB };
  } catch (err) {
    console.error(`Pitcher hydration failed for ${pitcherId}:`, err);
    return {
      fullName: "TBD",
      hand: "",
      era: "",
      eraLHB: "",
      eraRHB: ""
    };
  }
}

// ===============================
// ENDPOINT 1: /mlb (unchanged)
// ===============================
app.get("/mlb", async (req, res) => {
  try {
    const [oddsRes, parlayRes] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`),
      fetch(`https://api.parlay-api.com/v1/mlb/historical?apiKey=${PARLAY_API_KEY}`)
    ]);

    let oddsData = [];
    if (oddsRes.status === "fulfilled" && oddsRes.value.ok) {
      oddsData = await oddsRes.value.json();
    }

    let parlayData = null;
    if (parlayRes.status === "fulfilled" && parlayRes.value.ok) {
      parlayData = await parlayRes.value.json().catch(() => null);
    }

    const gamesByDate = {};

    oddsData.forEach((game) => {
      const gameDateStr = game.commence_time.split("T")[0];

      const formattedGame = {
        gamePk: game.id || "000000",
        gameGuid: game.id || "",
        gameType: "R",
        season: new Date().getFullYear().toString(),
        gameDate: game.commence_time,
        teams: {
          away: { team: { name: game.away_team } },
          home: { team: { name: game.home_team } }
        },
        parlayData
      };

      if (!gamesByDate[gameDateStr]) gamesByDate[gameDateStr] = [];
      gamesByDate[gameDateStr].push(formattedGame);
    });

    res.json({
      dates: Object.keys(gamesByDate).map((dateKey) => ({
        date: dateKey,
        games: gamesByDate[dateKey]
      }))
    });
  } catch (error) {
    res.status(500).json({ error: "Proxy Failed", details: error.message });
  }
});

// ===============================
// ENDPOINT 2: /pitchers?date=YYYY-MM-DD
// ===============================
app.get("/pitchers", async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) {
      return res.status(400).json({
        error: "Missing date parameter. Use /pitchers?date=YYYY-MM-DD"
      });
    }

    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${date}&endDate=${date}`;
    const scheduleRes = await fetch(scheduleUrl);
    const scheduleData = await scheduleRes.json();

    const output = [];

    if (scheduleData.dates?.length > 0) {
      for (const game of scheduleData.dates[0].games) {
        const homeTeam = game.teams.home.team.name;
        const awayTeam = game.teams.away.team.name;

        const homeRecord = game.teams.home.leagueRecord;
        const awayRecord = game.teams.away.leagueRecord;

        const homePitcherId = pitcherMap[homeTeam] || null;
        const awayPitcherId = pitcherMap[awayTeam] || null;

        const [homePitcher, awayPitcher] = await Promise.all([
          getPitcherDetails(homePitcherId),
          getPitcherDetails(awayPitcherId)
        ]);

        output.push({
          gamePk: game.gamePk,
          home_team: `${homeTeam} (${homeRecord.wins}-${homeRecord.losses})`,
          away_team: `${awayTeam} (${awayRecord.wins}-${awayRecord.losses})`,
          home_pitcher: `${homePitcher.fullName} (${homePitcher.hand}, ${homePitcher.era})`,
          away_pitcher: `${awayPitcher.fullName} (${awayPitcher.hand}, ${awayPitcher.era})`,
          home_pitcher_id: homePitcherId,
          away_pitcher_id: awayPitcherId,
          home_era_vs_lhb: homePitcher.eraLHB,
          home_era_vs_rhb: homePitcher.eraRHB,
          away_era_vs_lhb: awayPitcher.eraLHB,
          away_era_vs_rhb: awayPitcher.eraRHB
        });
      }
    }

    res.json({ pitchers: output });
  } catch (error) {
    res.status(500).json({ error: "Pitchers endpoint failed", details: error.message });
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
