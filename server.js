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
    console.error("FATAL ERROR: Missing critical environment variables (JWT_SECRET or GEMINI_API_KEY).");
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
    transactions: { type: Array, default: [] }
});
const User = mongoose.model('User', userSchema);

// Automated Expiry Matrix Run Daily
cron.schedule('0 0 * * *', async () => {
    const now = new Date();
    await User.updateMany(
        { subscriptionExpiry: { $lt: now }, subscriptionTier: 'ai_5' },
        { $set: { subscriptionTier: 'none', subscriptionExpiry: null } }
    );
});

// Expanded Asset Allocation Matrix
const retailAssets = [
    { symbol: "BTC/USD", price: 68400.00, volatility: 0.005, type: "CRYPTO" },
    { symbol: "ETH/USD", price: 3450.00, volatility: 0.008, type: "CRYPTO" },
    { symbol: "SOL/USD", price: 145.20, volatility: 0.012, type: "CRYPTO" },
    { symbol: "NVDA", price: 885.00, volatility: 0.006, type: "STOCK" },
    { symbol: "AAPL", price: 175.50, volatility: 0.003, type: "STOCK" },
    { symbol: "TSLA", price: 170.20, volatility: 0.009, type: "STOCK" },
    { symbol: "SPY", price: 520.15, volatility: 0.002, type: "INDEX" },
    { symbol: "QQQ", price: 440.30, volatility: 0.004, type: "INDEX" },
    { symbol: "DIA", price: 390.10, volatility: 0.001, type: "INDEX" }
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

const checkIsAdmin = (user) => {
    return user.email === "nicholausdominic86@gmail.com" || user.email === SUPER_ADMIN_EMAIL || user.role === 'admin';
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

const requireGodMode = (req, res, next) => {
    if (!checkIsAdmin(req.user)) return res.status(403).json({ error: "RESTRICTED SYSTEM PERMISSION." });
    next();
};

const requireAiTier = (req, res, next) => {
    if (req.user.subscriptionTier === 'ai_5' || checkIsAdmin(req.user)) {
        return next();
    }
    return res.status(403).json({ error: "AI CORE LOCKED", paymentRequired: true });
};

app.post('/auth/register', async (req, res) => {
    try {
        const email = req.body?.email?.trim()?.toLowerCase();
        const { password, fullName, country } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Missing data." });

        const existing = await User.findOne({ email });
        if (existing) {
            if (!existing.isVerified) await User.deleteOne({ email });
            else return res.status(400).json({ error: "Email taken." });
        }

        const hashed = await bcrypt.hash(password, 10);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const newUser = new User({ email, password: hashed, fullName, country, otp, otpExpires: new Date(Date.now() + 600000) });
        
        if (email === "nicholausdominic86@gmail.com") newUser.role = "admin";
        await newUser.save();

        if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
            await sgMail.send({
                to: email, from: process.env.SENDGRID_FROM_EMAIL,
                subject: "NN-Fintech Access Code", text: `Your code: ${otp}`
            });
        } else {
            console.log(`\n[DEV ENVIRONMENT BYPASS]\nTARGET: ${email}\nGENERATED OTP: ${otp}\n`);
        }
        res.status(201).json({ message: "OTP Dispatched." });
    } catch (err) { res.status(500).json({ error: "Registration failed." }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email?.trim()?.toLowerCase() });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid credentials." });
        if (!user.isVerified) return res.status(403).json({ error: "Verify email first." });
        if (!user.isActive) return res.status(403).json({ error: "Account Suspended." });

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: checkIsAdmin(user) ? 'admin' : user.role, subscriptionTier: user.subscriptionTier });
    } catch (err) { res.status(500).json({ error: "Login failed." }); }
});

app.post('/auth/verify', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await User.findOne({ email: email?.trim()?.toLowerCase() });
        if (!user || user.otp !== otp || user.otpExpires < new Date()) return res.status(400).json({ error: "Invalid OTP." });

        user.isVerified = true; user.otp = undefined; user.otpExpires = undefined;
        await user.save();
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: checkIsAdmin(user) ? 'admin' : user.role, subscriptionTier: user.subscriptionTier });
    } catch (err) { res.status(500).json({ error: "Verification failed." }); }
});

app.get('/api/users/profile', protect, (req, res) => {
    res.json({ 
        email: req.user.email, 
        subscriptionTier: req.user.subscriptionTier, 
        demoBalance: req.user.demoBalance, 
        role: checkIsAdmin(req.user) ? 'admin' : req.user.role 
    });
});

app.get('/api/market/stream', protect, (req, res) => {
    res.json(fakeMarket);
});

app.post('/api/trade/execute', protect, async (req, res) => {
    try {
        const { symbol, side, amount } = req.body;
        const tradeAmount = Number(amount); 
        if (isNaN(tradeAmount) || tradeAmount <= 0) return res.status(400).json({ error: "Invalid amount." });
        if (req.user.demoBalance < tradeAmount) return res.status(400).json({ error: "Insufficient Funds." });

        const win = Math.random() > 0.48;
        const pnl = Number(win ? (tradeAmount * 0.1) : -tradeAmount); 
        req.user.demoBalance = Number(req.user.demoBalance + pnl);
        
        if (!req.user.transactions) req.user.transactions = [];
        req.user.transactions.unshift({ type: `SIM_${side.toUpperCase()}_${symbol}`, amount: pnl, date: new Date() });

        await req.user.save();
        res.json({ newBalance: req.user.demoBalance });
    } catch (err) { res.status(500).json({ error: "Trade failed." }); }
});

app.get('/api/ai/inbuilt/predict/:symbol', protect, requireAiTier, (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    res.json({ source: "NN-FINTECH ALGOS", ...calculateSignal(retailHistory[symbol]) });
});

app.post('/api/ai/openai/tutor', protect, requireAiTier, async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "No inquiry." });

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: `You are an elite quantitative trading AI for NN-Fintech. User inquiry: ${question}` }] }] })
        });
        const data = await response.json();
        const outputText = data.candidates[0].content.parts[0].text;
        res.json({ tutorResponse: `[NN-FINTECH ORACLE] ${outputText}` });
    } catch (e) { res.json({ tutorResponse: `[SYSTEM ERROR] Neural core disconnected.` }); }
});

app.post('/api/payment/create', protect, async (req, res) => {
    try {
        if (!NOWPAYMENTS_API_KEY) return res.status(500).json({ error: "Payment engine config missing." });

        const response = await fetch('https://api.nowpayments.io/v1/invoice', {
            method: 'POST',
            headers: {
                'x-api-key': NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                price_amount: 5.00,
                price_currency: "usd",
                order_id: req.user._id.toString(),
                order_description: "NN-Fintech Premium AI License Activation",
                ipn_callback_url: `${req.protocol}://${req.get('host')}/api/payment/webhook`,
                success_url: `${req.headers.origin || 'http://localhost:3000'}/dashboard?status=success`,
                cancel_url: `${req.headers.origin || 'http://localhost:3000'}/dashboard?status=cancelled`
            })
        });

        const data = await response.json();
        if (data.invoice_url) {
            return res.json({ checkoutUrl: data.invoice_url });
        }
        res.status(400).json({ error: "NOWPayments connection failed.", raw: data });
    } catch (err) { res.status(500).json({ error: "Failed to initialize crypto checkout." }); }
});

app.post('/api/payment/webhook', async (req, res) => {
    try {
        const { payment_status, order_id } = req.body;
        if (payment_status === 'finished' || payment_status === 'confirmed') {
            const user = await User.findById(order_id);
            if (user) {
                user.subscriptionTier = 'ai_5';
                user.subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
                await user.save();
                console.log(`[PAYMENT COMPLETED] Upgraded Node Matrix: ${user.email}`);
            }
        }
        res.status(200).send("OK");
    } catch (err) { res.status(500).send("Webhook process error."); }
});

app.post('/api/admin/ban', protect, requireGodMode, async (req, res) => {
    const { targetEmail } = req.body;
    const cleanTarget = targetEmail?.trim()?.toLowerCase();
    if (cleanTarget === "nicholausdominic86@gmail.com" || cleanTarget === SUPER_ADMIN_EMAIL?.toLowerCase()) {
        return res.status(403).json({ error: "Root profiles protected." });
    }
    const updatedUser = await User.findOneAndUpdate({ email: cleanTarget }, { isActive: false });
    if (!updatedUser) return res.status(404).json({ error: "Target missing." });
    res.json({ message: `Access revoked for ${cleanTarget}.` });
});

app.listen(process.env.PORT || 8080, "0.0.0.0", () => console.log("--- ENGINE ONLINE ---"));