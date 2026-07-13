import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const PARLAY_API_KEY = "75119bea4ef8693d2dd6584565b87a1c";

// Normalize team names
function normalizeName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Fetch official MLB schedule map WITH probable pitchers
async function getMlbScheduleMap() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=probablePitcher`
    );
    const data = await res.json();

    const map = {};
    if (data.dates?.length > 0) {
      data.dates[0].games.forEach((g) => {
        const home = g.teams?.home?.team?.name;
        if (home) {
          const norm = normalizeName(home);
          map[norm] = {
            gamePk: g.gamePk.toString(),
            abstractState: g.status.abstractGameState,
            detailedState: g.status.detailedState,
            statusCode: g.status.statusCode,

            homePitcherId: g.teams?.home?.probablePitcher?.id || null,
            awayPitcherId: g.teams?.away?.probablePitcher?.id || null
          };
        }
      });
    }
    return map;
  } catch (err) {
    console.error("MLB map error:", err);
    return {};
  }
}

// Fetch Pitcher Hand + ERA
async function getPitcherDetails(pitcherId) {
  if (!pitcherId) return { hand: "", era: "" };

  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=stats(group=pitching,type=season)`;
    const res = await fetch(url);
    const data = await res.json();

    const person = data.people?.[0] || {};

    const handCode = person.pitchHand?.code || "";
    const handStr =
      handCode === "L" ? "LHP" : handCode === "R" ? "RHP" : "";

    let eraStr = "";
    const splits = person.stats?.[0]?.splits;
    if (splits?.length > 0 && splits[0].stat?.era) {
      eraStr = splits[0].stat.era;
    }

    return { hand: handStr, era: eraStr };
  } catch (err) {
    console.error(`Pitcher error ${pitcherId}:`, err);
    return { hand: "", era: "" };
  }
}

// ===============================
// DEBUG ENDPOINT — shows ParlayAPI format
// ===============================
app.get("/debug-odds", async (req, res) => {
  try {
    const oddsUrl = `https://api.parlay-api.com/v1/sports/baseball_mlb/live/points?apiKey=${PARLAY_API_KEY}`;
    const oddsRes = await fetch(oddsUrl);
    const oddsJson = await oddsRes.json();

    res.json({
      typeof: typeof oddsJson,
      isArray: Array.isArray(oddsJson),
      keys: Object.keys(oddsJson || {}),
      sample: oddsJson
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ===============================
// ENDPOINT: /mlb (SAFE VERSION)
// ===============================
app.get("/mlb", async (req, res) => {
  try {
    const oddsUrl = `https://api.parlay-api.com/v1/sports/baseball_mlb/live/points?apiKey=${PARLAY_API_KEY}`;
    const oddsRes = await fetch(oddsUrl);
    const oddsJson = await oddsRes.json();

    let games = [];

    if (Array.isArray(oddsJson)) {
      games = oddsJson;
    } else if (Array.isArray(oddsJson?.data)) {
      games = oddsJson.data;
    } else if (Array.isArray(oddsJson?.results)) {
      games = oddsJson.results;
    } else {
      console.error("Unexpected ParlayAPI format:", oddsJson);
      return res.status(500).json({
        error: "MLB endpoint failed",
        details: "ParlayAPI returned unexpected format"
      });
    }

    const mlbMap = await getMlbScheduleMap();
    const gamesByDate = {};

    games.forEach((game) => {
      const dateStr = game.commence_time.split("T")[0];

      const homeTeam = game.home_team;
      const awayTeam = game.away_team;

      const normHome = normalizeName(homeTeam);
      const mlb = mlbMap[normHome] || {};

      let dk = null;
      let mgm = null;

      if (Array.isArray(game.bookmakers)) {
        game.bookmakers.forEach((bk) => {
          const key = bk.key.toLowerCase();
          if (key.includes("draftkings")) dk = bk;
          if (key.includes("betmgm") || key.includes("mgm")) mgm = bk;
        });
      }

      const extractMarkets = (book) => {
        if (!book || !Array.isArray(book.markets)) return {};

        const ml = book.markets.find((m) => m.key === "h2h");
        const spread = book.markets.find((m) => m.key === "spreads");
        const totals = book.markets.find((m) => m.key === "totals");

        return {
          mlAway: ml?.outcomes?.find((o) => o.name === awayTeam)?.price ?? null,
          mlHome: ml?.outcomes?.find((o) => o.name === homeTeam)?.price ?? null,

          spreadAway: spread?.outcomes?.find((o) => o.name === awayTeam)?.point ?? null,
          spreadHome: spread?.outcomes?.find((o) => o.name === homeTeam)?.point ?? null,

          totalOver: totals?.outcomes?.find((o) => o.name === "Over")?.point ?? null,
          totalUnder: totals?.outcomes?.find((o) => o.name === "Under")?.point ?? null
        };
      };

      const dkData = extractMarkets(dk);
      const mgmData = extractMarkets(mgm);

      const formattedGame = {
        gamePk: mlb.gamePk || game.gameId || "",
        gameGuid: game.gameId || "",
        gameType: "R",
        season: new Date().getFullYear().toString(),
        gameDate: game.commence_time,

        status: {
          abstractGameState: mlb.abstractState || "Preview",
          detailedState: mlb.detailedState || "Scheduled",
          statusCode: mlb.statusCode || "S"
        },

        teams: {
          away: {
            score: 0,
            isWinner: false,
            team: { id: awayTeam, name: awayTeam }
          },
          home: {
            score: 0,
            isWinner: false,
            team: { id: homeTeam, name: homeTeam }
          }
        },

        venue: {
          id: 0,
          name: `${homeTeam} Stadium`
        },

        home_pitcher_id: mlb.homePitcherId || null,
        away_pitcher_id: mlb.awayPitcherId || null,

        parlayData: {
          draftkings_ml_away: dkData.mlAway,
          draftkings_ml_home: dkData.mlHome,
          draftkings_spread_away: dkData.spreadAway,
          draftkings_spread_home: dkData.spreadHome,
          draftkings_total_over: dkData.totalOver,
          draftkings_total_under: dkData.totalUnder,

          mgm_ml_away: mgmData.mlAway,
          mgm_ml_home: mgmData.mlHome,
          mgm_spread_away: mgmData.spreadAway,
          mgm_spread_home: mgmData.spreadHome,
          mgm_total_over: mgmData.totalOver,
          mgm_total_under: mgmData.totalUnder
        }
      };

      if (!gamesByDate[dateStr]) gamesByDate[dateStr] = [];
      gamesByDate[dateStr].push(formattedGame);
    });

    res.json({
      dates: Object.keys(gamesByDate).map((d) => ({
        date: d,
        games: gamesByDate[d]
      }))
    });
  } catch (err) {
    console.error("MLB endpoint error:", err);
    res.status(500).json({ error: "MLB endpoint failed", details: err.message });
  }
});

// ===============================
// ENDPOINT: /stats
// ===============================
app.get("/stats", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const mlbUrl =
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=probablePitcher`;

    const mlbRes = await fetch(mlbUrl);
    const mlbData = await mlbRes.json();

    const matchups = [];

    if (mlbData.dates?.length > 0) {
      for (const dateObj of mlbData.dates) {
        for (const game of dateObj.games) {
          const homeTeam = game.teams?.home || {};
          const awayTeam = game.teams?.away || {};

          const homePitcherRaw = homeTeam.probablePitcher || {};
          const awayPitcherRaw = awayTeam.probablePitcher || {};

          const [homeDetails, awayDetails] = await Promise.all([
            getPitcherDetails(homePitcherRaw.id),
            getPitcherDetails(awayPitcherRaw.id)
          ]);

          const homeWins = homeTeam.leagueRecord?.wins ?? 0;
          const homeLosses = homeTeam.leagueRecord?.losses ?? 0;
          const awayWins = awayTeam.leagueRecord?.wins ?? 0;
          const awayLosses = awayTeam.leagueRecord?.losses ?? 0;

          const homeTeamFormatted =
            `${homeTeam.team?.name || "Home"} (${homeWins}-${homeLosses})`;
          const awayTeamFormatted =
            `${awayTeam.team?.name || "Away"} (${awayWins}-${awayLosses})`;

          let homePitcherFormatted = homePitcherRaw.fullName || "TBD";
          if (homePitcherRaw.fullName) {
            const extra = [homeDetails.hand, homeDetails.era]
              .filter(Boolean)
              .join(", ");
            if (extra)
              homePitcherFormatted =
                `${homePitcherRaw.fullName} (${extra})`;
          }

          let awayPitcherFormatted = awayPitcherRaw.fullName || "TBD";
          if (awayPitcherRaw.fullName) {
            const extra = [awayDetails.hand, awayDetails.era]
              .filter(Boolean)
              .join(", ");
            if (extra)
              awayPitcherFormatted =
                `${awayPitcherRaw.fullName} (${extra})`;
          }

          matchups.push({
            gamePk: game.gamePk.toString(),
            home_team: homeTeamFormatted,
            away_team: awayTeamFormatted,

            home_pitcher: homePitcherFormatted,
            away_pitcher: awayPitcherFormatted,

            home_pitcher_id: homePitcherRaw.id || null,
            away_pitcher_id: awayPitcherRaw.id || null
          });
        }
      }
    }

    res.json({ matchups });
  } catch (err) {
    console.error("Stats Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch stats", details: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
