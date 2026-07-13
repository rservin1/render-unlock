app.get("/mlb", async (req, res) => {
  try {
    const oddsUrl = `https://api.parlay-api.com/v1/sports/baseball_mlb/odds?apiKey=${PARLAY_API_KEY}`;
    const oddsRes = await fetch(oddsUrl);
    const oddsJson = await oddsRes.json();

    if (!Array.isArray(oddsJson)) {
      console.error("Unexpected odds format:", oddsJson);
      return res.status(500).json({
        error: "MLB endpoint failed",
        details: "ParlayAPI returned unexpected odds format"
      });
    }

    const mlbMap = await getMlbScheduleMap();
    const gamesByDate = {};

    oddsJson.forEach((game) => {
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
