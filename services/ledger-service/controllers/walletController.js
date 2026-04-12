const Wallet = require('../models/wallet');


//===============================================================
// GET USER WALLET
//======================================================================================================================
const getWallet = async (req, res) => {
    try {
        const userId = req.user.id;
        let wallet = await Wallet.findOne({ userId });
        
        // If wallet doesn't exist, create a new one
        if (!wallet) {
            wallet = await Wallet.create({ userId });
        }

        res.status(200).json({ wallet });
    } catch (error) {
        console.error("Get wallet error:", error);
        res.status(500).json({ error: "Failed to retrieve wallet" });
    }
};

module.exports = {
    getWallet,
};