const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    walletType: { type: String, enum: ['user', 'admin_revenue', 'system_escrow'], default: 'user' },

    //Fiat Balance
    fiatBalance: { type: Number, default: 0 },

    //Crypto Assets
    cryptoAssets: [{
        symbol: { type: String, required: true },
        amount: { type: Number, default: 0 }
    }],

    //Stock Assets
    stockAssets: [{
        symbol: { type: String, required: true },
        shares: { type: Number, required: true, default: 0 }
    }],

    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
}, { timestamps: true });


module.exports = mongoose.model('Wallet', walletSchema);