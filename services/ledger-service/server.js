require ('dotenv').config({ path: '../../.env' });
const express = require('express');
const cors = require('cors');

// Import the shared MongoDB connection
const connectDB = require('../../shared/db');

//Initialize database connection
connectDB();

const app = express();
const PORT = process.env.LEDGER_PORT || 5002;

// Middleware
app.use(cors());
app.use(express.json());
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('[LEDGER] Dedicated Vault Pipeline Established'))
    .catch(err => console.error('[LEDGER] Vault Connection Failed:', err.message));

const transactionRoutes = require('./routes/transactions');
app.use('/transactions', transactionRoutes);

// =================================================
// MOUNT ROUTES
// =================================================
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/transfer', require('./routes/transfer'));

// HEALTH CHECK
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Ledger Service is healthy' });
});

// Start listening
app.listen(PORT, () => {
    console.log(`Ledger Service running on port ${PORT}`);
});