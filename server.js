const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || "nn_fintech_billionaire_2026";
const app = express();
const PORT = process.env.PORT || 8080;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(cors({
    origin: [
        "https://nn-fintech.com",
        "https://www.nn-fintech.com",
        "http://localhost:3000",
        "https://nn-fintech-frontend-abwc51m5w-mrfriggins-projects.vercel.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => res.send('NN-FINTECH ENGINE: OPERATIONAL'));

// --- DATABASE & SCHEMA ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ SAAS VAULT ONLINE: Database Connected."))
    .catch(err => console.error("❌ DB FATAL ERROR:", err));

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    fullName: { type: String },
    country: { type: String },
    role: { type: String, default: "user" },
    isVerified: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
    hasActiveSubscription: { type: Boolean, default: false }, 
    demoBalance: { type: Number, default: 0.00 }, 
    b2bKeys: [{ type: String }], 
    usedCryptoTxIds: [{ type: String }], 
    transactions: [{ type: Array, default: [] }]
});
const User = mongoose.model('User', userSchema);

// --- MARKET ENGINE ---
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
let stocks = [
    { symbol: "BTC", ticker: "X:BTCUSD", price: 68432.10, anchorPrice: 68432.10, change: "+0.00%", volatility: 0.002 },
    { symbol: "ETH", ticker: "X:ETHUSD", price: 3450.00, anchorPrice: 3450.00, change: "+0.00%", volatility: 0.003 },
    { symbol: "EUR/USD", ticker: "C:EURUSD", price: 1.08, anchorPrice: 1.08, change: "+0.00%", volatility: 0.0001 },
    { symbol: "S&P 500", ticker: "SPY", price: 520.10, anchorPrice: 520.10, change: "+0.00%", volatility: 0.0003 }
];
let syncIndex = 0;

const syncPolygonData = async () => {
    if (!POLYGON_API_KEY || POLYGON_API_KEY === "sb") return;
    try {
        const s = stocks[syncIndex];
        const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/${s.ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`);
        if (response.ok) {
            const data = await response.json();
            if (data.results?.[0]) {
                stocks[syncIndex].anchorPrice = data.results[0].c; 
                if (Math.abs(stocks[syncIndex].price - data.results[0].c) > (data.results[0].c * 0.05)) {
                    stocks[syncIndex].price = data.results[0].c;
                }
            }
        }
    } catch (e) {}
    syncIndex = (syncIndex + 1) % stocks.length;
};
setInterval(syncPolygonData, 60000);

setInterval(() => {
    stocks = stocks.map(s => {
        const movement = s.anchorPrice * (Math.random() * s.volatility * 2 - s.volatility);
        const finalPrice = parseFloat((s.price + movement + ((s.anchorPrice - (s.price + movement)) * 0.1)).toFixed(4));
        const changePct = (((finalPrice - s.price) / s.price) * 100).toFixed(2);
        return { ...s, price: finalPrice, change: `${changePct >= 0 ? '+' : ''}${changePct}%` };
    });
}, 5000);

// --- SECURITY MIDDLEWARE ---
const protect = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Access Denied." });
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (!user) return res.status(403).json({ error: "RESTRICTED" });
        req.user = user;
        next();
    } catch (err) { return res.status(401).json({ error: "Session Expired" }); }
};

// --- AUTHENTICATION ---
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
        await newUser.save();

        let emailSent = false;
        try {
            if (process.env.SENDGRID_API_KEY) { 
                await sgMail.send({
                    to: email, 
                    from: "nn.fintech.noreply@gmail.com", 
                    subject: "Vault Access: NN-Fintech", 
                    text: `Your Code is: ${otp}`,
                    html: `<h2>NN-Fintech Access</h2><p>Your Code: <strong style="color:#00ff41; background:#000; padding:10px;">${otp}</strong></p>`
                });
                emailSent = true;
            }
        } catch (e) {}
        
        res.status(201).json({ message: "OTP Dispatched.", emailDispatched: emailSent });
    } catch (err) { res.status(500).json({ error: "Server error." }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email?.trim()?.toLowerCase() });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid credentials." });
        if (!user.isVerified) return res.status(403).json({ error: "Verify email first." });
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, hasActiveSubscription: user.hasActiveSubscription });
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
        res.json({ token, role: user.role, hasActiveSubscription: user.hasActiveSubscription });
    } catch (err) { res.status(500).json({ error: "Verification failed." }); }
});

// --- CORE APIs ---
app.get('/api/users/profile', protect, (req, res) => {
    res.json({ email: req.user.email, hasActiveSubscription: req.user.hasActiveSubscription, demoBalance: req.user.demoBalance, role: req.user.role });
});

app.get('/api/market/stocks', protect, (req, res) => res.json(stocks));

app.post('/api/trade/execute', protect, async (req, res) => {
    try {
        const { symbol, amount, side } = req.body;
        if (!req.user.hasActiveSubscription || req.user.demoBalance < amount) return res.status(400).json({ error: "Insufficient Funds/Access." });
        const win = Math.random() > 0.48;
        const pnl = win ? (amount * 0.1) : -amount;
        req.user.demoBalance += pnl;
        req.user.transactions.unshift({ type: `SIM_${side.toUpperCase()}_${symbol}`, amount: pnl, date: new Date() });
        await req.user.save();
        res.json({ newBalance: req.user.demoBalance });
    } catch (err) { res.status(500).json({ error: "Trade failed." }); }
});

// --- RETAIL ACADEMY TUTOR (REPLACES QUANT AI) ---
app.post('/api/ai/tutor', protect, (req, res) => {
    if (!req.user.hasActiveSubscription) return res.status(403).json({ error: "Retail License Required for Academy Insights." });
    
    const { symbol } = req.body;
    const lessons = [
        `ACADEMY LESSON: What drives ${symbol}? Prices move based on Supply and Demand. When more buyers enter the market than sellers, the price goes up. Watch how the price reacts to news events.`,
        `RISK MANAGEMENT: Never risk your entire account on a single ${symbol} trade. Professional traders usually risk no more than 1% to 2% of their total balance per position.`,
        `TRADING PSYCHOLOGY: The market is driven by Fear and Greed. If you feel panicked watching ${symbol} drop, your position size is too big. Reduce your exposure.`,
        `MECHANICS: A "LONG" position means you buy ${symbol} hoping the price goes up. A "SHORT" position means you are betting against ${symbol}, making profit if the price falls.`,
        `TOOLSET: Always set a mental "Stop-Loss". This is the exact price where you admit your trade on ${symbol} was wrong and you close it to prevent a massive loss.`
    ];
    
    const selectedLesson = lessons[Math.floor(Math.random() * lessons.length)];
    res.json({ lesson: selectedLesson });
});

// --- ADMIN WATCHTOWER ---
app.post('/api/admin/force-upgrade', protect, async (req, res) => {
    req.user.role = 'admin';
    await req.user.save();
    res.json({ message: "Admin Rights Granted." });
});

app.get('/api/admin/all-transactions', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "UNAUTHORIZED" });
    try {
        const users = await User.find({}, 'email transactions').lean();
        const feed = users.flatMap(u => u.transactions.map(t => ({ ...t, userEmail: u.email })));
        res.json(feed.sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch (err) { res.status(500).json({ error: "Watchtower fail." }); }
});

app.post('/api/payment/verify-crypto', protect, async (req, res) => {
    try {
        const { txId, tier } = req.body;
        const existingClaim = await User.findOne({ usedCryptoTxIds: txId });
        if (existingClaim) return res.status(403).json({ error: "TxID claimed." });
        
        req.user.usedCryptoTxIds.push(txId);
        if (tier === "B2B") {
            const newKey = "nn_prod_" + crypto.randomBytes(16).toString('hex');
            req.user.b2bKeys.push(newKey);
            req.user.transactions.unshift({ type: "B2B_LICENSE", amount: -500, date: new Date(), key: newKey });
        } else {
            req.user.hasActiveSubscription = true;
            req.user.demoBalance = 100000;
            req.user.transactions.unshift({ type: "RETAIL_LICENSE", amount: -20, date: new Date() });
        }
        await req.user.save();
        res.json({ message: "License Activated." });
    } catch (err) { res.status(500).json({ error: "Payment fail." }); }
});

app.listen(PORT, "0.0.0.0", () => console.log(`--- [CORE] ENGINE RUNNING ON ${PORT} ---`));