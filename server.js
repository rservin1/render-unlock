// ==========================================
// ENDPOINT 2: HISTORICAL TRENDS & MATCHUPS (/stats)
// ==========================================
app.get("/stats", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    
    // Deeper hydration to fetch pitcher stats & pitch hand directly in one call
    const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${today}&endDate=${today}&hydrate=team,leagueRecord,probablePitcher(person,stats(group=[pitching],type=[season]))`;

    const mlbRes = await fetch(mlbUrl);
    const mlbData = await mlbRes.json();

    const matchups = [];

    if (mlbData.dates && mlbData.dates.length > 0) {
      for (const dateObj of mlbData.dates) {
        for (const game of dateObj.games) {
          const homeTeam = game.teams?.home || {};
          const awayTeam = game.teams?.away || {};

          // 1. Team + Record
          const homeWins = homeTeam.leagueRecord?.wins ?? 0;
          const homeLosses = homeTeam.leagueRecord?.losses ?? 0;
          const awayWins = awayTeam.leagueRecord?.wins ?? 0;
          const awayLosses = awayTeam.leagueRecord?.losses ?? 0;

          const homeTeamFormatted = `${homeTeam.team?.name || "Home"} (${homeWins}-${homeLosses})`;
          const awayTeamFormatted = `${awayTeam.team?.name || "Away"} (${awayWins}-${awayLosses})`;

          // Helper to parse pitch hand and ERA
          const parsePitcher = (pitcherObj) => {
            if (!pitcherObj || !pitcherObj.fullName) return "TBD";

            const name = pitcherObj.fullName;
            
            // Handedness check
            const handCode = pitcherObj.pitchHand?.code || pitcherObj.person?.pitchHand?.code || "";
            const handStr = handCode === "L" ? "LHP" : (handCode === "R" ? "RHP" : "");

            // ERA check inside stats array
            let era = "";
            const statsArr = pitcherObj.stats || pitcherObj.person?.stats || [];
            if (Array.isArray(statsArr)) {
              for (const s of statsArr) {
                if (s.splits && s.splits[0] && s.splits[0].stat && s.splits[0].stat.era) {
                  era = s.splits[0].stat.era;
                  break;
                }
              }
            }

            const details = [handStr, era].filter(Boolean).join(", ");
            return details ? `${name} (${details})` : name;
          };

          // 2. Pitcher Formatting
          const homePitcherFormatted = parsePitcher(homeTeam.probablePitcher);
          const awayPitcherFormatted = parsePitcher(awayTeam.probablePitcher);

          matchups.push({
            gamePk: game.gamePk.toString(),
            home_team: homeTeamFormatted,
            away_team: awayTeamFormatted,
            home_pitcher: homePitcherFormatted,
            away_pitcher: awayPitcherFormatted
          });
        }
      }
    }

    res.json({ matchups });

  } catch (error) {
    console.error("Stats Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch stats", details: error.message });
  }
});
