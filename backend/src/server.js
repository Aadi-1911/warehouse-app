// quiet: true suppresses dotenv's own "injected env... tip:" line, which rotates in random
// third-party ad text (e.g. vestauth.com) on every boot — no functional effect otherwise.
require('dotenv').config({ quiet: true });

// Automated tests run this same server against a separate Neon branch, never the real dev
// database — every controller below builds its own `new PrismaClient()` at require-time reading
// process.env.DATABASE_URL, so swapping it here (before any controller is required) is what
// actually redirects every one of them, with no per-controller changes needed.
if (process.env.NODE_ENV === 'test') {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('NODE_ENV=test requires TEST_DATABASE_URL to be set — refusing to fall back to DATABASE_URL and risk writing test data into the real dev database.');
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const factoryRoutes = require('./routes/factories');
const factoryPaymentRoutes = require('./routes/factoryPayments');
const colorRoutes = require('./routes/colors');
const categoryRoutes = require('./routes/categories');
const partyRoutes = require('./routes/parties');
const locationRoutes = require('./routes/locations');
const bundleRoutes = require('./routes/bundles');
const transactionRoutes = require('./routes/transactions');
const transferRoutes = require('./routes/transfers');
const stockRoutes = require('./routes/stock');
const userRoutes = require('./routes/users');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// CORS_ORIGIN restricts which frontend origin can call this API — without it, any site could.
app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

// Simple liveness check — confirms the server is up before any real routes exist.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/factories', factoryRoutes);
app.use('/api/factory-payments', factoryPaymentRoutes);
app.use('/api/colors', colorRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/bundles', bundleRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/users', userRoutes);

// Must be the LAST app.use() — Express only routes errors to handlers mounted after
// whatever threw them, and this is meant to catch anything any route above didn't.
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
