const express = require('express');
const router = express.Router();
const { getMarketPrice } = require('../controllers/marketController');

// ==========================================
// MARKET DATA ROUTES
// Base URL: /api/trading/market (Routed by Gateway)
// ==========================================

// GET /api/trading/market/:symbol
// Public/Protected route to check the current price of an asset
router.get('/:symbol', getMarketPrice);

module.exports = router;