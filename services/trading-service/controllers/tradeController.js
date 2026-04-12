const mongoose = require('mongoose');
const Trade = require('../models/Trade');
const Wallet = require('../../ledger-service/models/Wallet');
const Transaction = require('../../ledger-service/models/Transaction');
const { getLatestPrice } = require('../polygonAPI');

// ==========================================
// EXECUTE BUY OR SELL ORDER
// ==========================================
const executeTrade = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.user.id;
        const { symbol, side, quantity, assetType } = req.body; // e.g., 'AAPL', 'buy', 5, 'stock'

        if (quantity <= 0) throw new Error("Quantity must be greater than zero.");
        if (!['buy', 'sell'].includes(side)) throw new Error("Invalid trade side. Must be 'buy' or 'sell'.");

        // 1. Get Live Price
        const executionPrice = await getLatestPrice(symbol);
        const totalAmount = executionPrice * quantity;

        // 2. Fetch User Wallet
        const wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) throw new Error("Wallet not found.");
        if (wallet.status !== 'active') throw new Error("Wallet is frozen.");

        // 3. Process the Trade Logic
        if (side === 'buy') {
            // Check if user has enough USD
            if (wallet.fiatBalance < totalAmount) {
                throw new Error(`Insufficient funds. You need $${totalAmount.toFixed(2)} to buy ${quantity} shares of ${symbol}.`);
            }
            
            // Deduct USD
            wallet.fiatBalance -= totalAmount;

            // Add Asset to Wallet
            const assetIndex = wallet.stockAssets.findIndex(a => a.symbol === symbol.toUpperCase());
            if (assetIndex > -1) {
                wallet.stockAssets[assetIndex].shares += quantity;
            } else {
                wallet.stockAssets.push({ symbol: symbol.toUpperCase(), shares: quantity });
            }

        } else if (side === 'sell') {
            // Check if user has enough shares to sell
            const assetIndex = wallet.stockAssets.findIndex(a => a.symbol === symbol.toUpperCase());
            if (assetIndex === -1 || wallet.stockAssets[assetIndex].shares < quantity) {
                throw new Error(`Insufficient shares. You do not own ${quantity} shares of ${symbol}.`);
            }

            // Deduct Asset
            wallet.stockAssets[assetIndex].shares -= quantity;
            
            // If shares hit 0, remove the asset from the array entirely to keep the database clean
            if (wallet.stockAssets[assetIndex].shares === 0) {
                wallet.stockAssets.splice(assetIndex, 1);
            }

            // Add USD
            wallet.fiatBalance += totalAmount;
        }

        await wallet.save({ session });

        // 4. Record the Trade
        const trade = await Trade.create([{
            userId,
            symbol: symbol.toUpperCase(),
            assetType,
            side,
            quantity,
            executionPrice,
            totalAmount,
            status: 'executed'
        }], { session });

        // 5. Record the Ledger Transaction (for the fiat movement)
        const transaction = await Transaction.create([{
            senderId: side === 'buy' ? userId : new mongoose.Types.ObjectId(), // If buying, user sends money out.
            receiverId: side === 'sell' ? userId : new mongoose.Types.ObjectId(), // If selling, user receives money.
            type: side === 'buy' ? 'trade_buy' : 'trade_sell',
            amount: totalAmount,
            asset: 'USD',
            status: 'completed',
            externalReferenceId: trade[0]._id.toString() // Link to the specific trade
        }], { session });

        // 6. Finalize Database Commit
        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: `Successfully ${side === 'buy' ? 'bought' : 'sold'} ${quantity} shares of ${symbol.toUpperCase()}.`,
            trade: trade[0],
            newBalance: wallet.fiatBalance
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("Trade Execution Error:", error.message);
        res.status(400).json({ error: error.message || "Trade failed." });
    }
};

module.exports = {
    executeTrade
};