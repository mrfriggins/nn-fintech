require('dotenv').config({ path: __dirname + '/../../.env' });
const express = require('express');
const cors = require('cors');

const connectDB = require('../../shared/db');
connectDB();

const app = express();
const PORT = process.env.TRADING_PORT || 5004;

// Middleware
app.use(cors());
app.use(express.json());

// ==========================================
// MOUNT ROUTES
// ==========================================
app.use('/api/trading/market', require('./routes/market'));
app.use('/api/trading/execute', require('./routes/trade'));
app.use('/api/trading/ai-insights', require('./routes/aiInsights'));

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: "Trading Service Online" });
});

// Start listening
app.listen(PORT, () => {
    console.log(`📈 Trading Service running on port ${PORT}`);
});