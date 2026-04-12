const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');

router.post('/deposit', async (req, res) => {
    try {
        const { receiverId, amount, asset } = req.body;

        if (!receiverId || !amount || !asset) {
            return res.status(400).json({ error: "receiverId, amount, and asset are required." });
        }

        // Generate a dummy ObjectId to represent the "External Bank" sending the money
        const systemSenderId = new mongoose.Types.ObjectId();

        const newTx = new Transaction({
            senderId: systemSenderId,
            receiverId: receiverId,
            type: 'deposit',
            amount: amount,
            asset: asset,
            status: 'completed'
        });

        // Your AML Logic Check: Flag anything over $10,000
        if (amount >= 10000) {
            newTx.isFlagged = true;
            newTx.flagReason = "Automated AML System: Deposit exceeds $10,000 threshold.";
            newTx.status = 'pending'; // Hold the funds until CEO approval
        }

        await newTx.save();
        console.log(`[LEDGER] ${asset} Deposit Secured. AML Flag: ${newTx.isFlagged}`);
        
        res.status(201).json({ message: "Transaction processed.", transactionId: newTx._id, status: newTx.status });
    } catch (error) {
        console.error(`[LEDGER ERROR]`, error.message);
        res.status(500).json({ error: "Ledger write failed. Check database validation rules." });
    }
});
// CEO/Admin Route to override AML flags and settle transactions
router.put('/approve/:transactionId', async (req, res) => {
    try {
        const { transactionId } = req.params;

        // Find the locked transaction
        const tx = await Transaction.findById(transactionId);

        if (!tx) {
            return res.status(404).json({ error: "Transaction not found." });
        }

        if (tx.status === 'completed') {
            return res.status(400).json({ error: "Transaction is already settled." });
        }

        // Override the flag and release the funds
        tx.status = 'completed';
        tx.isFlagged = false;
        tx.flagReason = "Cleared by Admin";
        
        await tx.save();

        console.log(`[LEDGER] Transaction ${transactionId} AUTHORIZED. Funds released.`);
        res.status(200).json({ message: "Funds released successfully.", status: tx.status });

    } catch (error) {
        console.error(`[LEDGER ERROR]`, error.message);
        res.status(500).json({ error: "Failed to authorize transaction." });
    }
});
// Dynamic Balance Calculator
router.get('/balance/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Convert the incoming string ID into a mathematical database coordinate
        const userObjectId = new mongoose.Types.ObjectId(userId);

        // Instantly aggregate all 'completed' transactions where the user is the receiver
        const balances = await Transaction.aggregate([
            { $match: { receiverId: userObjectId, status: 'completed' } },
            { $group: { _id: "$asset", total: { $sum: "$amount" } } }
        ]);

        console.log(`[LEDGER] Balance calculated for User: ${userId}`);
        res.status(200).json({ 
            message: "Portfolio data retrieved.", 
            portfolio: balances 
        });

    } catch (error) {
        console.error(`[LEDGER ERROR]`, error.message);
        res.status(500).json({ error: "Failed to compute ledger balance." });
    }
});
module.exports = router;