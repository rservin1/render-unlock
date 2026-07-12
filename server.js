const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
const cache = new NodeCache({ stdTTL: 15 }); // 15s in-memory cache to save API credits

app.use(cors());

const API_KEY = '75119bea4ef8693d2dd6584565b87a1c';
const PARLAY_BASE_URL = 'https://parlay-api.com/v1';
const TARGET_BOOKS = ['draftkings', 'betmgm']; // Filtered exclusively for DK and BetMGM

// Caching Middleware
const cacheMiddleware = (req, res, next) => {
  const key = req.originalUrl;
  const cachedData = cache.get(key);
  if (cachedData) return res.json(cachedData);
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    cache.set(key, body);
    return originalJson(body);
  };
  next();
};

// ==========================================
// 1. MAIN MLB SCOREBOARD & INNING STATUS
// ==========================================
app.get('/mlb', cacheMiddleware, async (req, res) => {
  try {
    const mlbRes = await axios.get('https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=linescore,team');
    const dates = mlbRes.data.dates || [];

    const formattedDates = dates.map(d => ({
      date: d.date,
      games: d.games.map(g => {
        const linescore = g.linescore || {};
        return {
          gamePk: String(g.gamePk),
          gameGuid: g.gameGuid || '',
          gameType: g.gameType,
          season: g.season,
          gameDate: g.gameDate,
          gameDateMST: new Date(g.gameDate).toLocaleDateString('en-US', { timeZone: 'America/Phoenix' }),
          gameTimeMST: new Date(g.gameDate).toLocaleTimeString('en-US', { timeZone: 'America/Phoenix', hour: '2-digit', minute: '2-digit' }),
          dayNight: g.dayNight,
          scheduledInnings: g.scheduledInnings || 9,
          currentInning: linescore.currentInning || null,
          inningState: linescore.inningState || linescore.inningHalf || 'N/A', // Top / Bottom / Mid / End
          status: {
            abstractGameState: g.status.abstractGameState,
            detailedState: g.status.detailedState,
            statusCode: g.status.statusCode
          },
          teams: {
            away: {
              score: g.teams.away.score ?? 0,
              isWinner: g.teams.away.isWinner || false,
              team: { id: String(g.teams.away.team.id), name: g.teams.away.team.name }
            },
            home: {
              score: g.teams.home.score ?? 0,
              isWinner: g.teams.home.isWinner || false,
              team: { id: String(g.teams.home.team.id), name: g.teams.home.team.name }
            }
          },
          venue: { id: g.venue?.id || 0, name: g.venue?.name || '' }
        };
      })
    }));

    res.json({ dates: formattedDates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. PARLAY API PROXIED ENDPOINTS (DK & MGM ONLY)
// ==========================================

// Helper function for fetching from Parlay API
const fetchParlayAPI = async (endpoint, extraParams = {}) => {
  const url = `${PARLAY_BASE_URL}${endpoint}`;
  const response = await axios.get(url, {
    params: {
      apiKey: API_KEY,
      bookmakers: TARGET_BOOKS.join(','),
      ...extraParams
    }
  });
  return response.data;
};

// GET /v1/sports/:sport_key/live/points
app.get('/v1/sports/:sport_key/live/points', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI(`/sports/${req.params.sport_key}/live/points`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/sports/:sport_key/live/book_latency
app.get('/v1/sports/:sport_key/live/book_latency', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI(`/sports/${req.params.sport_key}/live/book_latency`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/sports/:sport_key/live/period_markets
app.get('/v1/sports/:sport_key/live/period_markets', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI(`/sports/${req.params.sport_key}/live/period_markets`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/inplay/arbs
app.get('/v1/inplay/arbs', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI('/inplay/arbs');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/historical/sports/:sport_key/odds (5 Credits)
app.get('/v1/historical/sports/:sport_key/odds', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI(`/historical/sports/${req.params.sport_key}/odds`, req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/historical/sports/:sport_key/closing-odds (5 Credits)
app.get('/v1/historical/sports/:sport_key/closing-odds', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI(`/historical/sports/${req.params.sport_key}/closing-odds`, req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/historical/sports/:sport_key/matches (2 Credits)
app.get('/v1/historical/sports/:sport_key/matches', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI(`/historical/sports/${req.params.sport_key}/matches`, req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/historical/stats
app.get('/v1/historical/stats', cacheMiddleware, async (req, res) => {
  try {
    const data = await fetchParlayAPI('/historical/stats', req.query);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/sports/:sport_key/live/sse (Server-Sent Events)
app.get('/v1/sports/:sport_key/live/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendUpdate = async () => {
    try {
      const data = await fetchParlayAPI(`/sports/${req.params.sport_key}/live/period_markets`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  };

  const intervalId = setInterval(sendUpdate, 3000); // Pulse stream every 3s
  req.on('close', () => clearInterval(intervalId));
});

// ==========================================
// 3. WEBSOCKET PUSH STREAM BACKBONE
// ==========================================
const initParlayWebSocket = (sportKey = 'baseball_mlb') => {
  const wsUrl = `wss://parlay-api.com/v1/ws/odds/${sportKey}?apiKey=${API_KEY}&bookmakers=${TARGET_BOOKS.join(',')}`;
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => console.log(`Connected to Parlay WebSocket for ${sportKey}`));
  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data.toString());
      // In-memory update store for ultra-fast response serving
      cache.set(`ws_odds_${sportKey}`, payload, 10);
    } catch (e) {
      console.error('Error parsing WS message:', e);
    }
  });

  ws.on('error', (err) => console.error('WebSocket Error:', err.message));
  ws.on('close', () => {
    console.log('WebSocket closed. Reconnecting in 5s...');
    setTimeout(() => initParlayWebSocket(sportKey), 5000);
  });
};

// Initialize WebSocket stream for MLB on server boot
initParlayWebSocket('baseball_mlb');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Parlay API Proxy Server active on port ${PORT}`));
