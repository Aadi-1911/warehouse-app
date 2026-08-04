require('dotenv').config();

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const factoryRoutes = require('./routes/factories');
const colorRoutes = require('./routes/colors');
const locationRoutes = require('./routes/locations');
const bundleRoutes = require('./routes/bundles');
const transactionRoutes = require('./routes/transactions');
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
app.use('/api/colors', colorRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/bundles', bundleRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/users', userRoutes);

// Must be the LAST app.use() — Express only routes errors to handlers mounted after
// whatever threw them, and this is meant to catch anything any route above didn't.
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
