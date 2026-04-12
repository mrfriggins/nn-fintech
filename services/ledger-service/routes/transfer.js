const express = require('express');
const router = express.Router();
const { executeTransfer } = require('../controllers/transferController');

// =========================================================
// TRANSFER ROUTES
// Base URL: /api/transfer
// =========================================================

// POST /api/transfer
// Protected route to send money to another user
router.post('/', executeTransfer);

module.exports = router;