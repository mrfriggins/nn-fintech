const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Import the blueprint

// The actual registration endpoint
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Ensure the payload isn't empty
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        // Build the user and save it to the vault
        const newUser = new User({ email, password });
        await newUser.save();

        console.log(`[IDENTITY] New User Secured: ${email}`);
        res.status(201).json({ message: "Registration successful.", userId: newUser._id });
        
    } catch (error) {
        console.error(`[IDENTITY ERROR]`, error.message);
        res.status(500).json({ error: "Failed to write to vault. Email might already exist." });
    }
});

module.exports = router;