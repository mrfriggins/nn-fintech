const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cron = require('node-cron');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const { JWT_SECRET, SUPER_ADMIN_EMAIL, ENCRYPTION_KEY, MONGO_URI, GEMINI_API_KEY } = process.env;

if (!JWT_SECRET || !ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32 || !GEMINI_API_KEY) {
    console.error("FATAL ERROR: Missing core environment variables (JWT_SECRET, ENCRYPTION_KEY (32 chars), or GEMINI_API_KEY).");
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
    subscriptionTier: { type: String, enum: ['none', 'retail_20', 'b2b_500'], default: 'none' },
    subscriptionExpiry: { type: Date, default: null },
    demoBalance: { type: Number, default: 0.00 },
    transactions: { type: Array, default: [] }
});
const User = mongoose.model('User', userSchema);

cron.schedule('0 0 * * *', async () => {
    const now = new Date();
    await User.updateMany(
        { subscriptionExpiry: { $lt: now }, subscriptionTier: { $ne: 'none' } },
        { $set: { subscriptionTier: 'none' } }
    );
});

const retailAssets = [
    { symbol: "BTC/USD", price: 68400.00, volatility: 0.005 },
    { symbol: "ETH/USD", price: 3450.00, volatility: 0.008 },
    { symbol: "SOL/USD", price: 145.20, volatility: 0.012 },
    { symbol: "SPY", price: 520.15, volatility: 0.002 },
    { symbol: "GOLD", price: 2350.00, volatility: 0.004 },
    { symbol: "NVDA", price: 885.00, volatility: 0.006 }
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
    if (!checkIsAdmin(req.user)) {
        return res.status(403).json({ error: "RESTRICTED SYSTEM PERMISSION." });
    }
    next();
};

const hasAccess = (req) => req.user.subscriptionTier !== 'none' || checkIsAdmin(req.user);

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
        
        if (email === "nicholausdominic86@gmail.com") {
            newUser.role = "admin";
        }
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

app.post('/auth/forgot-password', async (req, res) => {
    try {
        const email = req.body?.email?.trim()?.toLowerCase();
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ error: "Identity not found." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp; user.otpExpires = new Date(Date.now() + 600000);
        await user.save();

        if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
            await sgMail.send({
                to: email, from: process.env.SENDGRID_FROM_EMAIL,
                subject: "NN-Fintech Password Reset", text: `Your reset code is: ${otp}. Valid for 10 minutes.`
            });
        } else {
            console.log(`\n[DEV ENVIRONMENT BYPASS]\nPASSWORD RESET TARGET: ${email}\nGENERATED RESET OTP: ${otp}\n`);
        }
        res.json({ message: "Reset code processed." });
    } catch (err) { res.status(500).json({ error: "Failed to dispatch reset code." }); }
});

app.post('/auth/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const user = await User.findOne({ email: email?.trim()?.toLowerCase() });
        
        if (!user || user.otp !== otp || user.otpExpires < new Date()) {
            return res.status(400).json({ error: "Invalid or expired reset code." });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.otp = undefined; user.otpExpires = undefined;
        await user.save();

        res.json({ message: "Cryptographic key successfully updated." });
    } catch (err) { res.status(500).json({ error: "Failed to process reset." }); }
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
    if (!hasAccess(req)) return res.status(403).json({ error: "Payment required." });
    res.json(fakeMarket);
});

app.post('/api/trade/execute', protect, async (req, res) => {
    try {
        if (!hasAccess(req)) return res.status(403).json({ error: "License required." });
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

app.get('/api/ai/inbuilt/predict/:symbol', protect, (req, res) => {
    if (!hasAccess(req)) return res.status(403).json({ error: "Payment required." });
    const symbol = decodeURIComponent(req.params.symbol);
    res.json({ source: "NN-FINTECH ALGOS", ...calculateSignal(retailHistory[symbol]) });
});

app.post('/api/ai/openai/tutor', protect, async (req, res) => {
    if (!hasAccess(req)) return res.status(403).json({ error: "License Required." });
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