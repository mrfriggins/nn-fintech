const express = require('express');
const router = express.Router();
const { initiateDeposit, confirmDeposit } = require('../controllers/paymentController');

// ==========================================
// DEPOSIT ROUTES (Real Money)
// Base URL: /api/payments/deposit (Routed by Gateway)
// ==========================================

// POST /api/payments/deposit/initiate
// Protected route to generate the PayPal checkout link
router.post('/initiate', initiateDeposit);

// POST /api/payments/deposit/confirm
// Protected route to capture the funds after user approves on PayPal
router.post('/confirm', confirmDeposit);

module.exports = router;