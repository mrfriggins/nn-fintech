const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cron = require('node-cron');
require('dotenv').config();

// --- ENVIRONMENT VALIDATION ---
const { JWT_SECRET, SUPER_ADMIN_EMAIL, ENCRYPTION_KEY, MONGO_URI } = process.env;

if (!JWT_SECRET || !SUPER_ADMIN_EMAIL || !ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
    console.error("FATAL ERROR: Missing or invalid environment variables. ENCRYPTION_KEY must be exactly 32 characters.");
    process.exit(1);
}

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"], credentials: true }));
app.use(express.json());

// --- 1. CRYPTOGRAPHY MODULE (BYOK) ---
const IV_LENGTH = 16;
const encryptKey = (text) => {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
};

const decryptKey = (text) => {
    if (!text) return null;
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
};

// --- 2. DATABASE SCHEMA ---
mongoose.connect(MONGO_URI || "mongodb://localhost:27017/nnfintech")
    .then(() => console.log("✅ Database Connected."))
    .catch(err => console.error("Database Error:", err));

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    
    // Subscriptions
    subscriptionTier: { type: String, enum: ['none', 'retail_20', 'b2b_500'], default: 'none' },
    subscriptionExpiry: { type: Date, default: null },
    demoBalance: { type: Number, default: 0.00 },
    
    // B2B Infrastructure
    b2bKey: { type: String, default: null }, // Used to access YOUR API
    allowedOrigin: { type: String, default: null }, // Domain lock
    clientPolygonKey: { type: String, default: null } // Encrypted BYOK
});
const User = mongoose.model('User', userSchema);

// --- 3. AUTOMATED SUBSCRIPTION LIFECYCLE ---
cron.schedule('0 0 * * *', async () => {
    console.log("[SYSTEM] Executing daily subscription sweep...");
    const now = new Date();
    
    // Terminate expired accounts
    await User.updateMany(
        { subscriptionExpiry: { $lt: now }, subscriptionTier: { $ne: 'none' } },
        { $set: { subscriptionTier: 'none', b2bKey: null } }
    );

    // Identify 7-day warnings
    const oneWeekOutStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const oneWeekOutEnd = new Date(oneWeekOutStart.getTime() + 24 * 60 * 60 * 1000);
    
    const warningUsers = await User.find({
        subscriptionExpiry: { $gte: oneWeekOutStart, $lt: oneWeekOutEnd },
        subscriptionTier: { $ne: 'none' }
    });

    warningUsers.forEach(user => {
        console.log(`[SYSTEM] Dispatching 7-day warning email to ${user.email}`);
        // Integrate SendGrid here for the warning email
    });
});

// --- 4. THE IN-BUILT AI (MATH ALGORITHM) ---
// Analyzes an array of historical prices to output a signal
const calculateSignal = (priceHistory) => {
    if (!priceHistory || priceHistory.length < 5) return { signal: "NEUTRAL", confidence: "0%" };
    
    const currentPrice = priceHistory[priceHistory.length - 1];
    const avgPrice = priceHistory.reduce((a, b) => a + b, 0) / priceHistory.length;
    
    let signal = "NEUTRAL";
    if (currentPrice > avgPrice * 1.002) signal = "STRONG BUY";
    else if (currentPrice > avgPrice) signal = "BUY";
    else if (currentPrice < avgPrice * 0.998) signal = "STRONG SELL";
    else if (currentPrice < avgPrice) signal = "SELL";

    return { signal, currentPrice, movingAverage: parseFloat(avgPrice.toFixed(4)) };
};

// --- 5. RETAIL SIMULATOR ($20 DEMO TIER) ---
const retailAssets = [
    { symbol: "BTC/USD", price: 65000, volatility: 0.005 },
    { symbol: "ETH/USD", price: 3400, volatility: 0.008 },
    { symbol: "EUR/USD", price: 1.08, volatility: 0.0002 },
    { symbol: "SPY", price: 510, volatility: 0.002 }
];

const retailHistory = {};
retailAssets.forEach(a => retailHistory[a.symbol] = Array(20).fill(a.price));
let fakeMarket = [...retailAssets];

setInterval(() => {
    fakeMarket = fakeMarket.map(asset => {
        const movement = asset.price * (Math.random() * asset.volatility * 2 - asset.volatility);
        const newPrice = parseFloat((asset.price + movement).toFixed(4));
        retailHistory[asset.symbol].shift();
        retailHistory[asset.symbol].push(newPrice);
        return { ...asset, price: newPrice };
    });
}, 3000);

// --- 6. MIDDLEWARES ---
const protect = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (!user || !user.isActive) return res.status(403).json({ error: "Access Denied. Account Suspended." });
        req.user = user;
        next();
    } catch (err) { res.status(401).json({ error: "Session Expired." }); }
};

const requireGodMode = (req, res, next) => {
    if (req.user.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: "RESTRICTED: Admin Only." });
    next();
};

const b2bGateway = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const origin = req.headers.origin || req.headers.referer;

    if (!apiKey) return res.status(401).json({ error: "API Key Required." });

    const user = await User.findOne({ b2bKey: apiKey, subscriptionTier: 'b2b_500' });
    if (!user || !user.isActive) return res.status(403).json({ error: "Invalid Key or Expired Subscription." });

    if (user.allowedOrigin && !origin?.startsWith(user.allowedOrigin)) {
        return res.status(403).json({ error: `Domain locked to ${user.allowedOrigin}` });
    }
    
    req.b2bClient = user;
    next();
};

// --- 7. RETAIL ENDPOINTS ($20 TIER) ---
app.get('/api/market/stream', protect, (req, res) => {
    if (req.user.subscriptionTier === 'none') return res.status(403).json({ error: "Payment required." });
    res.json(fakeMarket);
});

app.get('/api/ai/inbuilt/predict/:symbol', protect, (req, res) => {
    if (req.user.subscriptionTier === 'none') return res.status(403).json({ error: "Payment required." });
    const symbol = decodeURIComponent(req.params.symbol);
    const prediction = calculateSignal(retailHistory[symbol]);
    res.json({ source: "NN-FINTECH ALGOS (SIMULATED)", ...prediction });
});

app.post('/api/ai/openai/tutor', protect, async (req, res) => {
    if (req.user.subscriptionTier === 'none') return res.status(403).json({ error: "Payment required." });
    const { symbol, question } = req.body;
    const asset = fakeMarket.find(a => a.symbol === symbol);
    res.json({ tutorResponse: `[OPENAI TUTOR] The current simulated price of ${symbol} is $${asset?.price || 'unknown'}. For "${question}", look at structural support. Do not trade real money based on this demo.` });
});

// --- 8. B2B EXTERNAL API ($500 TIER - BYOK LIVE DATA) ---
app.get('/v1/b2b/market-stream', b2bGateway, async (req, res) => {
    try {
        if (!req.b2bClient.clientPolygonKey) return res.status(400).json({ error: "No Polygon API key linked to account." });
        
        const activeKey = decryptKey(req.b2bClient.clientPolygonKey);
        const tickers = ["X:BTCUSD", "X:ETHUSD", "C:EURUSD"];
        
        // Date math to get a 10-day history for the AI algorithm
        const today = new Date().toISOString().split('T')[0];
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const promises = tickers.map(async (ticker) => {
            const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${tenDaysAgo}/${today}?adjusted=true&apiKey=${activeKey}`);
            if (!response.ok) throw new Error(`Polygon API Limit/Error for ${ticker}`);
            
            const data = await response.json();
            const historicalPrices = data.results ? data.results.map(day => day.c) : [];
            
            return {
                symbol: ticker,
                price: historicalPrices.length > 0 ? historicalPrices[historicalPrices.length - 1] : null,
                inbuiltAIPrediction: calculateSignal(historicalPrices)
            };
        });

        const liveData = await Promise.all(promises);
        res.json({ provider: "NN-Fintech Central Processing", status: "Active", data: liveData });
    } catch (err) {
        res.status(502).json({ error: "Upstream Data Failure. Check client API limits." });
    }
});

// --- 9. GOD-MODE ADMIN GATEWAY ---
app.post('/api/admin/provision-b2b', protect, requireGodMode, async (req, res) => {
    const { targetEmail, allowedDomain, plainTextPolygonKey } = req.body;
    
    const user = await User.findOneAndUpdate(
        { email: targetEmail },
        { 
            subscriptionTier: 'b2b_500',
            subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            b2bKey: "nn_api_" + crypto.randomBytes(32).toString('hex'),
            allowedOrigin: allowedDomain,
            clientPolygonKey: encryptKey(plainTextPolygonKey)
        },
        { new: true }
    );
    
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ message: "B2B Node Provisioned.", api_key: user.b2bKey });
});

app.post('/api/admin/ban', protect, requireGodMode, async (req, res) => {
    const { targetEmail } = req.body;
    await User.findOneAndUpdate({ email: targetEmail }, { isActive: false });
    res.json({ message: `Access revoked for ${targetEmail}.` });
});

app.listen(process.env.PORT || 8080, "0.0.0.0", () => console.log("--- ENGINE ONLINE ---"));