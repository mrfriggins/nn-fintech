const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    symbol: { type: String, required: true, uppercase: true }, // e.g., AAPL, BTC
    assetType: { type: String, enum: ['stock', 'crypto', 'real_estate_reit'], required: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    
    quantity: { type: Number, required: true },
    executionPrice: { type: Number, required: true },
    totalAmount: { type: Number, required: true }, // quantity * executionPrice
    
    status: { type: String, enum: ['pending', 'executed', 'failed'], default: 'executed' },
    
    // Links back to the exact ledger transaction that moved the money
    ledgerTransactionId: { type: mongoose.Schema.Types.ObjectId }
}, { timestamps: true });

module.exports = mongoose.model('Trade', tradeSchema);