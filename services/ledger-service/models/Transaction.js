const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true },
    type: {
        type: String,
        enum: ['transfer', 'Withdrawal', 'refund', 'deposit', 'trade_buy', 'trade_sell', 'exchange', 'fee' ],
        required: true
    },
    amount: {
        type: Number, required: true },
        asset: { type: String, required: true },//'USD', 'EUR', 'BTC', AAPL, TSLA, etc.

        // For tracking the >$10000 AML rule
        isFlagged: { type: Boolean, default: false },
        flagReason: { type: String },

        status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'reversed'], default: 'pending' },

        externalReferenceId: { type: String }, // For linking to external systems (e.g., payment gateways, exchanges)

}, { timestamps: true });

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);