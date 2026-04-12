const express = require('express');
const router = express.Router();
const { getTradingAdvice } = require('../controllers/aiInsightsController');

// ==========================================
// AI INSIGHTS ROUTES
// Base URL: /api/trading/ai-insights (Routed by Gateway)
// ==========================================

// POST /api/trading/ai-insights/
// Protected route to request AI analysis on a specific asset
router.post('/', getTradingAdvice);

module.exports = router;