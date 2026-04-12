const axios = require('axios');

// ==========================================
// FETCH LIVE ASSET PRICE
// ==========================================
const getLatestPrice = async (symbol) => {
    try {
        const apiKey = process.env.POLYGON_API_KEY;
        if (!apiKey) throw new Error("Missing Polygon API Key");

        // Note: Polygon's free tier provides end-of-day data. 
        // For absolute real-time, you need a paid tier or use a crypto endpoint.
        // This hits the snapshot endpoint to get the most recent valid price.
        const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol.toUpperCase()}?apiKey=${apiKey}`;
        
        const response = await axios.get(url);
        
        if (!response.data || !response.data.ticker || !response.data.ticker.day) {
            throw new Error(`Invalid symbol or no data available for ${symbol}`);
        }

        // Return the current price (using the last trade price or closing price)
        const currentPrice = response.data.ticker.day.c; 
        
        return currentPrice;

    } catch (error) {
        console.error(`Polygon API Error for ${symbol}:`, error.response?.data || error.message);
        throw new Error(`Failed to fetch live price for ${symbol}. Market may be closed or symbol invalid.`);
    }
};

module.exports = {
    getLatestPrice
};