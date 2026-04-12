const express = require('express');
const router = express.Router();

// Basic test route
router.get('/test', (req, res) => {
    res.json({ message: "KYC route is connected." });
});

module.exports = router;