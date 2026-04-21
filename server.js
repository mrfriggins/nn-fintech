const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cron = require('node-cron');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

// --- ENVIRONMENT VALIDATION ---
const { JWT_SECRET, SUPER_ADMIN_EMAIL, ENCRYPTION_KEY, MONGO_URI, OPENAI_API_KEY } = process.env;

if (!JWT_SECRET || !SUPER_ADMIN_EMAIL || !ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
    console.error("FATAL ERROR: Missing or invalid environment variables. ENCRYPTION_KEY must be exactly 32 characters.");
    process.exit(1);
}

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"], credentials: true }));
app.use(express.json());

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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
    transactions: { type: Array, default: [] },
    
    b2bKey: { type: String, default: null },
    allowedOrigin: { type: String, default: null },
    clientPolygonKey: { type: String, default: null }
});
const User = mongoose.model('User', userSchema);

// --- 3. AUTOMATED SUBSCRIPTION SWEEP ---
cron.schedule('0 0 * * *', async () => {
    const now = new Date();
    await User.updateMany(
        { subscriptionExpiry: { $lt: now }, subscriptionTier: { $ne: 'none' } },
        { $set: { subscriptionTier: 'none', b2bKey: null } }
    );
});

// --- 4. EXPANDED RETAIL SIMULATOR ($20 DEMO TIER) ---
const retailAssets = [
    // Crypto (15 Assets)
    { symbol: "BTC/USD", price: 68400.00, volatility: 0.005 },
    { symbol: "ETH/USD", price: 3450.00, volatility: 0.008 },
    { symbol: "SOL/USD", price: 145.20, volatility: 0.012 },
    { symbol: "XRP/USD", price: 0.61, volatility: 0.010 },
    { symbol: "ADA/USD", price: 0.45, volatility: 0.015 },
    { symbol: "DOT/USD", price: 8.50, volatility: 0.011 },
    { symbol: "LINK/USD", price: 18.20, volatility: 0.012 },
    { symbol: "MATIC/USD", price: 0.95, volatility: 0.014 },
    { symbol: "AVAX/USD", price: 45.30, volatility: 0.016 },
    { symbol: "DOGE/USD", price: 0.15, volatility: 0.020 },
    { symbol: "SHIB/USD", price: 0.000025, volatility: 0.025 },
    { symbol: "LTC/USD", price: 95.50, volatility: 0.009 },
    { symbol: "BCH/USD", price: 480.00, volatility: 0.011 },
    { symbol: "UNI/USD", price: 11.20, volatility: 0.013 },
    { symbol: "ATOM/USD", price: 10.80, volatility: 0.012 },

    // Forex (12 Pairs)
    { symbol: "EUR/USD", price: 1.0850, volatility: 0.0002 },
    { symbol: "GBP/USD", price: 1.2630, volatility: 0.0003 },
    { symbol: "USD/JPY", price: 151.20, volatility: 0.001 },
    { symbol: "AUD/USD", price: 0.6540, volatility: 0.0004 },
    { symbol: "USD/CAD", price: 1.3520, volatility: 0.0003 },
    { symbol: "USD/CHF", price: 0.9050, volatility: 0.0003 },
    { symbol: "NZD/USD", price: 0.5980, volatility: 0.0004 },
    { symbol: "EUR/GBP", price: 0.8590, volatility: 0.0002 },
    { symbol: "EUR/JPY", price: 164.10, volatility: 0.0008 },
    { symbol: "GBP/JPY", price: 191.05, volatility: 0.0009 },
    { symbol: "AUD/JPY", price: 98.90, volatility: 0.0007 },
    { symbol: "USD/CNH", price: 7.2450, volatility: 0.0003 },

    // Indices (8 Assets)
    { symbol: "SPY", price: 520.15, volatility: 0.002 },
    { symbol: "QQQ", price: 445.30, volatility: 0.003 },
    { symbol: "DIA", price: 395.10, volatility: 0.0015 },
    { symbol: "IWM", price: 205.40, volatility: 0.0025 },
    { symbol: "VIX", price: 14.50, volatility: 0.050 },
    { symbol: "FTSE", price: 7950.20, volatility: 0.002 },
    { symbol: "DAX", price: 18200.50, volatility: 0.0025 },
    { symbol: "NIKKEI", price: 39800.00, volatility: 0.003 },

    // Commodities (14 Assets)
    { symbol: "GOLD", price: 2350.00, volatility: 0.004 },
    { symbol: "SILVER", price: 28.50, volatility: 0.006 },
    { symbol: "PLATINUM", price: 950.00, volatility: 0.005 },
    { symbol: "PALLADIUM", price: 1020.00, volatility: 0.008 },
    { symbol: "COPPER", price: 4.15, volatility: 0.007 },
    { symbol: "USOIL (WTI)", price: 82.40, volatility: 0.008 },
    { symbol: "UKOIL (BRENT)", price: 86.90, volatility: 0.007 },
    { symbol: "NATGAS", price: 1.85, volatility: 0.015 },
    { symbol: "CORN", price: 435.50, volatility: 0.005 },
    { symbol: "WHEAT", price: 560.25, volatility: 0.006 },
    { symbol: "SOYBEANS", price: 1180.00, volatility: 0.005 },
    { symbol: "COFFEE", price: 185.40, volatility: 0.008 },
    { symbol: "SUGAR", price: 22.10, volatility: 0.007 },
    { symbol: "COTTON", price: 92.50, volatility: 0.006 },

    // Equities (15 Assets)
    { symbol: "AAPL", price: 172.50, volatility: 0.003 },
    { symbol: "TSLA", price: 175.20, volatility: 0.009 },
    { symbol: "MSFT", price: 425.10, volatility: 0.0025 },
    { symbol: "NVDA", price: 885.00, volatility: 0.006 },
    { symbol: "AMZN", price: 185.30, volatility: 0.004 },
    { symbol: "GOOGL", price: 155.40, volatility: 0.0035 },
    { symbol: "META", price: 505.20, volatility: 0.005 },
    { symbol: "NFLX", price: 620.10, volatility: 0.0045 },
    { symbol: "AMD", price: 180.50, volatility: 0.007 },
    { symbol: "INTC", price: 40.20, volatility: 0.004 },
    { symbol: "BA", price: 190.40, volatility: 0.005 },
    { symbol: "DIS", price: 115.60, volatility: 0.0035 },
    { symbol: "JPM", price: 198.50, volatility: 0.002 },
    { symbol: "V", price: 280.10, volatility: 0.0025 },
    { symbol: "WMT", price: 60.50, volatility: 0.0015 }
];

let fakeMarket = [...retailAssets];
setInterval(() => {
    fakeMarket = fakeMarket.map(asset => {
        const movement = asset.price * (Math.random() * asset.volatility * 2 - asset.volatility);
        return { ...asset, price: parseFloat((asset.price + movement).toFixed(4)) };
    });
}, 3000);

// --- 5. MIDDLEWARES ---
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
    if (req.user.email !== SUPER_ADMIN_EMAIL && req.user.role !== 'admin') return res.status(403).json({ error: "RESTRICTED: Admin Only." });
    next();
};

const hasAccess = (req) => {
    return req.user.subscriptionTier !== 'none' || req.user.email === SUPER_ADMIN_EMAIL || req.user.role === 'admin';
};

// --- 6. AUTHENTICATION & IDENTITY ---
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

        if (process.env.SENDGRID_API_KEY) {
            await sgMail.send({
                to: email, from: process.env.SENDGRID_FROM_EMAIL || "nn.fintech.noreply@gmail.com",
                subject: "NN-Fintech Access Code", text: `Your code: ${otp}`
            });
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
        res.json({ token, role: user.email === SUPER_ADMIN_EMAIL ? 'admin' : user.role, subscriptionTier: user.subscriptionTier });
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
        res.json({ token, role: user.email === SUPER_ADMIN_EMAIL ? 'admin' : user.role, subscriptionTier: user.subscriptionTier });
    } catch (err) { res.status(500).json({ error: "Verification failed." }); }
});

app.get('/api/users/profile', protect, (req, res) => {
    res.json({ 
        email: req.user.email, 
        subscriptionTier: req.user.subscriptionTier, 
        demoBalance: req.user.demoBalance, 
        role: req.user.email === SUPER_ADMIN_EMAIL ? 'admin' : req.user.role 
    });
});

// --- 7. CORE PLATFORM & AI ---
app.get('/api/market/stream', protect, (req, res) => {
    if (!hasAccess(req)) return res.status(403).json({ error: "Payment required." });
    res.json(fakeMarket);
});

app.post('/api/trade/execute', protect, async (req, res) => {
    try {
        if (!hasAccess(req)) return res.status(403).json({ error: "License required." });
        const { symbol, amount, side } = req.body;
        if (req.user.demoBalance < amount) return res.status(400).json({ error: "Insufficient Funds." });

        const win = Math.random() > 0.48;
        const pnl = win ? (amount * 0.1) : -amount;
        req.user.demoBalance += pnl;
        
        if (!req.user.transactions) req.user.transactions = [];
        req.user.transactions.unshift({ type: `SIM_${side.toUpperCase()}_${symbol}`, amount: pnl, date: new Date() });
        await req.user.save();
        res.json({ newBalance: req.user.demoBalance });
    } catch (err) { res.status(500).json({ error: "Trade failed." }); }
});

app.post('/api/ai/openai/tutor', protect, async (req, res) => {
    if (!hasAccess(req)) return res.status(403).json({ error: "Retail License Required." });
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "No inquiry provided." });

    try {
        if (!OPENAI_API_KEY) throw new Error("Missing Key");
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
            body: JSON.stringify({
                model: "gpt-4o-mini", 
                messages: [
                    { role: "system", content: "You are an elite, omniscient quantitative trading AI for NN-Fintech. Answer any question about financial markets, strategies, technical analysis, crypto, or macroeconomics. Be authoritative and concise. Do not use financial disclaimers." },
                    { role: "user", content: question }
                ],
                max_tokens: 300, temperature: 0.7
            })
        });

        if (!response.ok) throw new Error("OpenAI API rejected the request");
        const data = await response.json();
        res.json({ tutorResponse: `[NN-FINTECH ORACLE] ${data.choices[0].message.content}` });
    } catch (e) {
        res.json({ tutorResponse: `[SYSTEM ERROR] Neural network offline. Re-establish connection.` });
    }
});

// --- 8. PAYMENT INTEGRATION (NOWPAYMENTS) ---
app.post('/api/payment/create-invoice', protect, async (req, res) => {
    const { tier } = req.body;
    const priceAmount = tier === 'RETAIL' ? 20 : (tier === 'B2B' ? 500 : 0);
    if (!priceAmount) return res.status(400).json({ error: "Invalid tier." });

    try {
        const response = await fetch('https://api.nowpayments.io/v1/invoice', {
            method: 'POST',
            headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                price_amount: priceAmount, price_currency: "usd", pay_currency: "usdtmatic",
                order_id: `${req.user._id}_${tier}_${Date.now()}`,
                order_description: `NN-Fintech ${tier} License`,
                ipn_callback_url: "https://nn-fintech.onrender.com/api/payment/webhook"
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Gateway failed.");
        res.json({ invoice_url: data.invoice_url });
    } catch (err) { res.status(500).json({ error: "Failed to generate crypto invoice." }); }
});

app.post('/api/payment/webhook', async (req, res) => {
    const sig = req.headers['x-nowpayments-sig'];
    if (!sig) return res.status(403).json({ error: "Missing signature." });

    const hmac = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET);
    hmac.update(JSON.stringify(req.body, Object.keys(req.body).sort()));
    if (hmac.digest('hex') !== sig) return res.status(403).json({ error: "Invalid signature." });

    const { payment_status, order_id } = req.body;
    if (payment_status === 'finished' || payment_status === 'confirmed') {
        const [userId, tier] = order_id.split('_');
        const user = await User.findById(userId);
        if (user) {
            user.subscriptionTier = tier === 'B2B' ? 'b2b_500' : 'retail_20';
            user.subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
            if (tier === 'B2B' && !user.b2bKey) user.b2bKey = "nn_api_" + crypto.randomBytes(32).toString('hex');
            if (tier === 'RETAIL') user.demoBalance += 100000; 
            if (!user.transactions) user.transactions = [];
            user.transactions.unshift({ type: `${tier}_LICENSE_ACTIVATION`, amount: tier === 'B2B' ? -500 : -20, date: new Date() });
            await user.save();
        }
    }
    res.status(200).send("OK");
});

// --- 9. GOD-MODE WATCHTOWER ---
app.get('/api/admin/all-transactions', protect, requireGodMode, async (req, res) => {
    try {
        const feed = await User.aggregate([
            { $unwind: "$transactions" },
            { $sort: { "transactions.date": -1 } },
            { $limit: 100 },
            { $project: { _id: 0, userEmail: "$email", type: "$transactions.type", amount: "$transactions.amount", date: "$transactions.date" } }
        ]);
        res.json(feed);
    } catch (err) { res.status(500).json({ error: "Watchtower database overload." }); }
});

app.listen(process.env.PORT || 8080, "0.0.0.0", () => console.log("--- ENGINE ONLINE ---"));