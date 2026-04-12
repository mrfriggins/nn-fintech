const { getLatestPrice } = require('../polygonAPI');

// ==========================================
// GET LIVE ASSET PRICE
// ==========================================
const getMarketPrice = async (req, res) => {
    try {
        const { symbol } = req.params;
        
        if (!symbol) {
            return res.status(400).json({ error: "Stock or Crypto symbol is required." });
        }

        const price = await getLatestPrice(symbol);

        res.status(200).json({ 
            symbol: symbol.toUpperCase(), 
            currentPrice: price 
        });

    } catch (error) {
        console.error("Market Controller Error:", error.message);
        res.status(500).json({ error: error.message || "Failed to fetch market data." });
    }
};

module.exports = {
    getMarketPrice
};