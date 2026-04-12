const express = require('express');
const router = express.Router();
const { executeTrade } = require('../controllers/tradeController');

// ==========================================
// TRADE EXECUTION ROUTES
// Base URL: /api/trading/execute (Routed by Gateway)
// ==========================================

// POST /api/trading/execute/
// Protected route to buy or sell an asset
router.post('/', executeTrade);

module.exports = router;