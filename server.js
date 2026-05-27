const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const { 
    JWT_SECRET, 
    SUPER_ADMIN_EMAIL, 
    MONGO_URI, 
    GEMINI_API_KEY, 
    NOWPAYMENTS_API_KEY, 
    NOWPAYMENTS_IPN_SECRET 
} = process.env;

if (!JWT_SECRET || !GEMINI_API_KEY) {
    console.error("FATAL ERROR: Missing critical environment variables.");
    process.exit(1);
}

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"], credentials: true }));
app.use(express.json());

if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

mongoose.connect(MONGO_URI || "mongodb://localhost:27017/nnfintech")
    .then(() => console.log("✅ Database Connected."))
    .catch(err => console.error("Database Error:", err));

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    fullName: { type: String },
    country: { type: String },
    role: { type: String, default: "user" },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    otp: { type: String },
    otpExpires: { type: Date },
    subscriptionTier: { type: String, enum: ['none', 'ai_5'], default: 'none' },
    subscriptionExpiry: { type: Date, default: null },
    demoBalance: { type: Number, default: 10000.00 },
    transactions: { type: Array, default: [] },
    activePositions: { type: Array, default: [] } 
});
const User = mongoose.model('User', userSchema);

cron.schedule('0 0 * * *', async () => {
    const now = new Date();
    await User.updateMany(
        { subscriptionExpiry: { $lt: now }, subscriptionTier: 'ai_5' },
        { $set: { subscriptionTier: 'none', subscriptionExpiry: null } }
    );
});

const retailAssets = [
    { symbol: "BTC/USD", price: 68400.00, volatility: 0.005, type: "CRYPTO" },
    { symbol: "ETH/USD", price: 3450.00, volatility: 0.008, type: "CRYPTO" },
    { symbol: "SOL/USD", price: 145.20, volatility: 0.012, type: "CRYPTO" },
    { symbol: "NVDA", price: 885.00, volatility: 0.006, type: "STOCK" },
    { symbol: "AAPL", price: 175.50, volatility: 0.003, type: "STOCK" },
    { symbol: "TSLA", price: 170.20, volatility: 0.009, type: "STOCK" },
    { symbol: "SPY", price: 520.15, volatility: 0.002, type: "INDEX" }
];

const retailHistory = {};
retailAssets.forEach(a => retailHistory[a.symbol] = Array(20).fill(a.price));
let fakeMarket = retailAssets.map(a => ({ ...a, openPrice: a.price, change: "+0.00%" }));

setInterval(() => {
    fakeMarket = fakeMarket.map(asset => {
        const movement = asset.price * (Math.random() * asset.volatility * 2 - asset.volatility);
        const newPrice = parseFloat((asset.price + movement).toFixed(4));
        retailHistory[asset.symbol].shift();
        retailHistory[asset.symbol].push(newPrice);
        const changePct = (((newPrice - asset.openPrice) / asset.openPrice) * 100).toFixed(2);
        return { ...asset, price: newPrice, change: changePct >= 0 ? `+${changePct}%` : `${changePct}%` };
    });
}, 3000);

const calculateSignal = (priceHistory) => {
    if (!priceHistory || priceHistory.length < 5) return { signal: "NEUTRAL" };
    const currentPrice = priceHistory[priceHistory.length - 1];
    const avgPrice = priceHistory.reduce((a, b) => a + b, 0) / priceHistory.length;
    let signal = "NEUTRAL";
    if (currentPrice > avgPrice * 1.002) signal = "STRONG BUY";
    else if (currentPrice > avgPrice) signal = "BUY";
    else if (currentPrice < avgPrice * 0.998) signal = "STRONG SELL";
    else if (currentPrice < avgPrice) signal = "SELL";
    return { signal, currentPrice, movingAverage: parseFloat(avgPrice.toFixed(4)) };
};

const protect = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (!user || !user.isActive) return res.status(403).json({ error: "Access Denied." });
        req.user = user;
        next();
    } catch (err) { res.status(401).json({ error: "Session Expired." }); }
};

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email?.trim()?.toLowerCase() });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid credentials." });
        if (!user.isVerified) return res.status(403).json({ error: "Verify email first." });
        
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user });
    } catch (err) { res.status(500).json({ error: "Login failed." }); }
});

app.get('/api/users/profile', protect, (req, res) => {
    res.json({ 
        email: req.user.email, 
        subscriptionTier: req.user.subscriptionTier, 
        demoBalance: req.user.demoBalance, 
        role: req.user.role,
        activePositions: req.user.activePositions || []
    });
});

app.get('/api/market/stream', protect, (req, res) => {
    res.json(fakeMarket);
});

app.post('/api/trade/execute', protect, async (req, res) => {
    try {
        const { symbol, side, amount, sl, tp } = req.body;
        const tradeAmount = Number(amount); 
        if (isNaN(tradeAmount) || tradeAmount <= 0) return res.status(400).json({ error: "Invalid amount." });
        if (req.user.demoBalance < tradeAmount) return res.status(400).json({ error: "Insufficient Margin." });

        const asset = fakeMarket.find(a => a.symbol === symbol);
        if (!asset) return res.status(400).json({ error: "Asset data offline." });

        const position = {
            id: Math.random().toString(36).substring(2, 10),
            symbol,
            side,
            amount: tradeAmount,
            entryPrice: asset.price,
            sl: sl ? Number(sl) : null,
            tp: tp ? Number(tp) : null,
            date: new Date()
        };

        req.user.demoBalance -= tradeAmount;
        req.user.activePositions.push(position);
        await req.user.save();

        res.json({ newBalance: req.user.demoBalance, position });
    } catch (err) { res.status(500).json({ error: "Trade execution failed." }); }
});

app.post('/api/trade/close', protect, async (req, res) => {
    try {
        const { positionId } = req.body;
        const posIndex = req.user.activePositions.findIndex(p => p.id === positionId);
        if (posIndex === -1) return res.status(404).json({ error: "Position not found." });

        const pos = req.user.activePositions[posIndex];
        const asset = fakeMarket.find(a => a.symbol === pos.symbol);
        const exitPrice = asset ? asset.price : pos.entryPrice;

        const pnlFactor = pos.side === 'buy' ? (exitPrice - pos.entryPrice) / pos.entryPrice : (pos.entryPrice - exitPrice) / pos.entryPrice;
        const rawPnl = pos.amount * pnlFactor;
        const returnAmount = pos.amount + rawPnl;

        req.user.demoBalance += returnAmount;
        req.user.activePositions.splice(posIndex, 1);
        req.user.transactions.unshift({ type: `CLOSE_${pos.side.toUpperCase()}_${pos.symbol}`, amount: rawPnl, date: new Date() });

        await req.user.save();
        res.json({ newBalance: req.user.demoBalance });
    } catch (err) { res.status(500).json({ error: "Failed to close position." }); }
});

app.get('/api/ai/inbuilt/predict/:symbol', protect, (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    res.json({ source: "NN-FINTECH ALGOS", ...calculateSignal(retailHistory[symbol]) });
});

app.listen(process.env.PORT || 8080, "0.0.0.0", () => console.log("--- ENGINE ONLINE ---"));