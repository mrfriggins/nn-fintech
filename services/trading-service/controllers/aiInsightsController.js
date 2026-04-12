const { OpenAI } = require('openai');

// Initialize OpenAI. It automatically looks for process.env.OPENAI_API_KEY
const openai = new OpenAI(); 

// ==========================================
// GENERATE AI TRADING ADVICE
// ==========================================
const getTradingAdvice = async (req, res) => {
    try {
        const { symbol, assetType } = req.body;

        if (!symbol) {
            return res.status(400).json({ error: "Symbol is required for AI analysis." });
        }

        // Call OpenAI to generate a ruthless, data-driven analysis
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Can upgrade to gpt-4 when scaling
            messages: [
                { 
                    role: "system", 
                    content: "You are a brutally honest, top-tier financial analyst. Provide a strict, 2-paragraph assessment of the provided asset. Focus on raw data, market sentiment, and ruthless risk assessment. Do not offer financial advice, but provide aggressive analytical insights." 
                },
                { 
                    role: "user", 
                    content: `Provide an immediate market analysis on ${assetType || 'asset'} symbol: ${symbol.toUpperCase()}.` 
                }
            ],
            max_tokens: 200,
            temperature: 0.5
        });

        res.status(200).json({
            symbol: symbol.toUpperCase(),
            insight: response.choices[0].message.content
        });

    } catch (error) {
        console.error("OpenAI Error:", error.message);
        res.status(500).json({ error: "Failed to generate AI insights. Check API limits." });
    }
};

module.exports = {
    getTradingAdvice
};