// ==========================================
// ENDPOINT 1: LIVE SCORES + REAL ODDS (/mlb)
// ==========================================
app.get("/mlb", async (req, res) => {
  try {
    const [scoresRes, oddsRes, mlbMapRes] = await Promise.allSettled([
      fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/scores/?apiKey=${ODDS_API_KEY}&daysFrom=1`),
      fetch(`https://api.parlay-api.com/v1/sports/baseball_mlb/odds?apiKey=${PARLAY_API_KEY}`),
      getMlbScheduleMap()
    ]);

    // SCORES
    let scoresData = [];
    if (scoresRes.status === "fulfilled" && scoresRes.value.ok) {
      scoresData = await scoresRes.value.json();
    }

    // ODDS
    let oddsData = [];
    if (oddsRes.status === "fulfilled" && oddsRes.value.ok) {
      oddsData = await oddsRes.value.json();
    }

    const mlbMap = mlbMapRes.status === "fulfilled" ? mlbMapRes.value : {};

    const gamesByDate = {};

    scoresData.forEach((game) => {
      const dateStr = game.commence_time.split("T")[0];

      const homeTeam = game.home_team;
      const awayTeam = game.away_team;

      // Scores
      let homeScore = 0;
      let awayScore = 0;

      if (Array.isArray(game.scores)) {
        const homeObj = game.scores.find((s) => s.name === homeTeam);
        const awayObj = game.scores.find((s) => s.name === awayTeam);

        homeScore = parseInt(homeObj?.score || 0);
        awayScore = parseInt(awayObj?.score || 0);
      }

      // Odds match
      const oddsMatch = oddsData.find(
        (o) =>
          o.home_team === homeTeam &&
          o.away_team === awayTeam
      );

      let dk = null;
      let mgm = null;

      if (oddsMatch && Array.isArray(oddsMatch.bookmakers)) {
        oddsMatch.bookmakers.forEach((bk) => {
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

      const normHome = normalizeName(homeTeam);
      const mlb = mlbMap[normHome] || {};

      const formattedGame = {
        gamePk: mlb.gamePk || game.id || "",
        gameGuid: game.id || "",
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
            score: awayScore,
            isWinner: awayScore > homeScore,
            team: { id: awayTeam, name: awayTeam }
          },
          home: {
            score: homeScore,
            isWinner: homeScore > awayScore,
            team: { id: homeTeam, name: homeTeam }
          }
        },

        venue: {
          id: 0,
          name: `${homeTeam} Stadium`
        },

        odds: {
          draftkings: dkData,
          mgm: mgmData
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
