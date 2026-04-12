const express = require('express');
const router = express.Router();
const { getWallet } = require('../controllers/walletController');

// =============================================================
// WALLET ROUTES
// Base URL: /api/wallet
// =============================================================

// GET /api/wallet/
// Protected route to get the logged-in user's wallet information
router.get('/', getWallet);

module.exports = router;