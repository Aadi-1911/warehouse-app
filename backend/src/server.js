require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

// CORS_ORIGIN restricts which frontend origin can call this API — without it, any site could.
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

// Simple liveness check — confirms the server is up before any real routes exist.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
