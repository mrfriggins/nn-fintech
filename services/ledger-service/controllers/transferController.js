const mongoose = require ('mongoose');
const Wallet = require ('../models/wallet');
const Transaction = require ('../models/transaction');

// ================================================
// USER TO USER TRANSFER
// ================================================
const executeTransfer = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const senderId = req.user.id;
        const { recipientId, amount, asset } = req.body;

        // BASIC VALIDATION

        if (amount<= 0) throw new Error('Amount must be greater than zero');

        if (senderId === recipientId) throw new Error('Sender and recipient cannot be the same');
        // FETCH WALLETS
        const senderWallet = await Wallet.findOne({ userId: senderId, asset }).session(session);
        const recipientWallet = await Wallet.findOne({ userId: recipientId, asset }).session(session);

        if (!senderWallet || senderWallet.status !== 'active') throw new Error('Sender wallet not found or inactive');
        if (!recipientWallet || recipientWallet.status !== 'active') throw new Error('Recipient wallet not found or inactive');

        // Check AML (Anti-Money Laundering) rule
        let isFlagged = false;
        let flagReason = '';
        if (amount > 10000 && asset === 'USD') {
            isFlagged = true;
            flagReason = 'Amount exceeds AML threshold';
        }

        // Process transfer

        if (asset === 'USD') {
            if
            (senderWallet.fiatBalance < amount) throw new Error('Insufficient funds.');

            senderWallet.fiatBalance -= amount;
            recipientWallet.fiatBalance += amount;

            await senderWallet.save({ session });
            await recipientWallet.save({ session });
        } else {
            throw new Error('Unsupported asset type');
        }

        // Create the Immutable Ledger Record

        const transaction = await Transaction.create([{
            senderId,
            receiverId,
            type: 'transfer',
            amount,
            asset,
            isFlagged,
            flagReason,
            status: 'completed'
        }], { session });

        // COMMIT TRANSACTION
        await session.commitTransaction();
        session.endSession();


        res.status(200).json({ message: 'Transfer successful', transactionId: transaction[0]._id });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Transfer failed:', error);

        res.status(400).json({ error: error.message || 'Transfer failed' });
    }
};

module.exports = {
    executeTransfer
};

