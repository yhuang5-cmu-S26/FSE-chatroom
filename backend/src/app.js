const express = require('express');
const cors = require('cors');

const checkinRoutes = require('./routes/checkins');
const helpRequestRoutes = require('./routes/helpRequests');
const locationRoutes = require('./routes/locations');

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
  })
);
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/checkins', checkinRoutes);
app.use('/api/help-requests', helpRequestRoutes);
app.use('/api/locations', locationRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'internal server error' });
});

module.exports = app;
