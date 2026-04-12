const express = require('express');
const router = express.Router();
const { requestWithdrawal, approveWithdrawal } = require('../controllers/withdrawController');

// ==========================================
// WITHDRAWAL ROUTES
// Base URL: /api/payments/withdraw (Routed by Gateway)
// ==========================================

// POST /api/payments/withdraw/request
// Protected route for users to request their money
router.post('/request', requestWithdrawal);

// POST /api/payments/withdraw/approve
// Highly protected route (Admin only) to finalize the payout
router.post('/approve', approveWithdrawal);

module.exports = router;