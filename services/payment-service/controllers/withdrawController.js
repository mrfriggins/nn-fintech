const mongoose = require('mongoose');
const Wallet = require('../../ledger-service/models/Wallet');
const Transaction = require('../../ledger-service/models/Transaction');

// ==========================================
// USER REQUESTS WITHDRAWAL
// ==========================================
const requestWithdrawal = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.user.id;
        const { amount, payoutMethod, payoutDetails } = req.body; // e.g., 50, 'paypal', 'user@email.com'

        if (amount < 20) throw new Error("Minimum withdrawal amount is $20.");

        // 1. Find Wallet
        const wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) throw new Error("Wallet not found.");
        if (wallet.fiatBalance < amount) throw new Error("Insufficient funds for withdrawal.");

        // 2. Deduct funds immediately to prevent double-spending
        wallet.fiatBalance -= amount;
        await wallet.save({ session });

        // 3. Create Pending Transaction
        const transaction = await Transaction.create([{
            senderId: userId,
            receiverId: new mongoose.Types.ObjectId(), // System/External ID
            type: 'withdrawal',
            amount: amount,
            asset: 'USD',
            status: 'pending',
            externalReferenceId: `${payoutMethod}:${payoutDetails}` // Store where to send it
        }], { session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: "Withdrawal requested successfully. Pending admin approval.",
            transaction: transaction[0]
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Withdrawal Request Error:", error);
        res.status(400).json({ error: error.message || "Failed to request withdrawal." });
    }
};

// ==========================================
// ADMIN APPROVES WITHDRAWAL
// ==========================================
const approveWithdrawal = async (req, res) => {
    try {
        // Security Check: Ensure the user making this request is an Admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: "Unauthorized. Admin access required." });
        }

        const { transactionId, externalProviderReference } = req.body;

        // 1. Find the pending transaction
        const transaction = await Transaction.findById(transactionId);
        if (!transaction || transaction.status !== 'pending') {
            return res.status(404).json({ error: "Pending transaction not found." });
        }

        // 2. Trigger the actual payout
        // Here you would call the PayPal Payouts API or your Bank API
        // axios.post('https://api-m.paypal.com/v1/payments/payouts', { ... })
        
        // 3. Mark as completed
        transaction.status = 'completed';
        transaction.externalReferenceId = externalProviderReference; // Save the PayPal Payout Batch ID
        await transaction.save();

        res.status(200).json({
            message: "Withdrawal approved and processed.",
            transaction
        });

    } catch (error) {
        console.error("Approve Withdrawal Error:", error);
        res.status(500).json({ error: "Failed to approve withdrawal." });
    }
};

module.exports = {
    requestWithdrawal,
    approveWithdrawal
};