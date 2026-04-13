const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || "nn_fintech_billionaire_2026";
const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// --- SECURITY & MIDDLEWARE ---
// ==========================================
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

// ==========================================
// --- 1. EMAIL TRANSMITTER ---
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_APP_PASSWORD 
    },
    tls: { rejectUnauthorized: false }
});

// ==========================================
// --- 2. DATABASE & SCHEMA ---
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("--- [SYSTEM] SAAS VAULT ONLINE ---"))
    .catch(err => { console.error("!!! DB FATAL ERROR !!! Check MONGO_URI in Render Env Vars.", err); });

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

// ==========================================
// --- 3. MARKET ENGINE (POLYGON SYNC) ---
// ==========================================
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
    } catch (e) { /* silent fail for simulation continuity */ }
    syncIndex = (syncIndex + 1) % stocks.length;
};
setInterval(syncPolygonData, 60000);

// LIVE PRICE SIMULATOR
setInterval(() => {
    stocks = stocks.map(s => {
        const movement = s.anchorPrice * (Math.random() * s.volatility * 2 - s.volatility);
        const finalPrice = parseFloat((s.price + movement + ((s.anchorPrice - (s.price + movement)) * 0.1)).toFixed(4));
        const changePct = (((finalPrice - s.price) / s.price) * 100).toFixed(2);
        return { ...s, price: finalPrice, change: `${changePct >= 0 ? '+' : ''}${changePct}%` };
    });
}, 5000);

// ==========================================
// --- 4. SECURITY MIDDLEWARE ---
// ==========================================
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

// ==========================================
// --- 5. AUTHENTICATION (CRASH-PROOF) ---
// ==========================================
app.post('/auth/register', async (req, res) => {
    try {
        const email = req.body?.email?.trim()?.toLowerCase();
        const password = req.body?.password;
        const fullName = req.body?.fullName;
        const country = req.body?.country;

        if (!email || !password) return res.status(400).json({ error: "Email/Password required." });
        
        // If they exist but aren't verified, let's delete the ghost account to let them try again
        const existing = await User.findOne({ email });
        if (existing) {
            if (!existing.isVerified) {
                await User.deleteOne({ email });
                console.log(`[AUTH] Cleared unverified ghost account for ${email}`);
            } else {
                return res.status(400).json({ error: "Email already taken and verified." });
            }
        }

        const hashed = await bcrypt.hash(password, 10);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // --- THE BILLIONAIRE INTERCEPTOR ---
        console.log(`\n=========================================`);
        console.log(`[VAULT ACCESS] OTP GENERATED FOR ${email}`);
        console.log(`>>>>> ${otp} <<<<<`);
        console.log(`=========================================\n`);

        const newUser = new User({ email, password: hashed, fullName, country, otp, otpExpires: new Date(Date.now() + 600000) });
        await newUser.save();

        try {
            if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
                await transporter.sendMail({
                    from: `"NN-Fintech Vault" <${process.env.EMAIL_USER}>`,
                    to: email, subject: "Access Code", text: `Your code: ${otp}`
                });
                console.log(`[EMAIL] Dispatched to ${email}`);
            } else {
                console.log(`[EMAIL] Bypassed: Missing Google App Credentials in Render.`);
            }
        } catch (e) { 
            console.error("[EMAIL] Nodemailer failed. Check Google App Passwords.", e); 
        }
        
        // Send the success response regardless of email failure
        res.status(201).json({ message: "Code generated. Check email or server logs." });
    } catch (err) { 
        console.error("[DB FATAL] Registration crashed during save:", err);
        res.status(500).json({ error: "Database rejection. Check logs." }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const email = req.body?.email?.trim()?.toLowerCase();
        const password = req.body?.password;
        if (!email || !password) return res.status(400).json({ error: "Missing data." });

        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid credentials." });
        if (!user.isVerified) return res.status(403).json({ error: "Verify email first." });

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, hasActiveSubscription: user.hasActiveSubscription });
    } catch (err) { res.status(500).json({ error: "Login crash." }); }
});

app.post('/auth/verify', async (req, res) => {
    try {
        const email = req.body?.email?.trim()?.toLowerCase();
        const otp = req.body?.otp;
        const user = await User.findOne({ email });
        if (!user || user.otp !== otp || user.otpExpires < new Date()) return res.status(400).json({ error: "Invalid or expired OTP." });

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, hasActiveSubscription: user.hasActiveSubscription });
    } catch (err) { res.status(500).json({ error: "Verify fail." }); }
});

// ==========================================
// --- 6. CRYPTO & B2B PAYMENT ENGINE ---
// ==========================================
app.post('/api/payment/verify-crypto', protect, async (req, res) => {
    try {
        const { txId, tier } = req.body;
        if (!txId || !tier) return res.status(400).json({ error: "Missing TxID/Tier." });
        
        const existingClaim = await User.findOne({ usedCryptoTxIds: txId });
        if (existingClaim) return res.status(403).json({ error: "TxID already claimed." });

        const isB2B = tier === "B2B";
        const EXPECTED_VALUE = isB2B ? 500000000 : 20000000; 
        const MASTER_WALLET = process.env.MASTER_CRYPTO_WALLET?.toLowerCase();

        const scanUrl = `https://api.etherscan.io/v2/api?chainid=137&module=account&action=tokentx&address=${MASTER_WALLET}&apikey=${process.env.ETHERSCAN_API_KEY}`;
        const response = await fetch(scanUrl);
        const data = await response.json();
        const transaction = data.result?.find(tx => tx.hash.toLowerCase() === txId.toLowerCase());

        if (!transaction || transaction.to.toLowerCase() !== MASTER_WALLET || parseInt(transaction.value) < EXPECTED_VALUE) {
            return res.status(400).json({ error: "Payment verification failed." });
        }

        req.user.usedCryptoTxIds.push(txId);
        if (isB2B) {
            const newKey = "nn_prod_" + crypto.randomBytes(16).toString('hex');
            req.user.b2bKeys.push(newKey);
            req.user.transactions.unshift({ type: "B2B_LICENSE", amount: -500, date: new Date(), key: newKey });
            await req.user.save();
            return res.json({ message: "B2B Activated. Key in profile." });
        } else {
            req.user.hasActiveSubscription = true;
            req.user.demoBalance = 100000;
            req.user.transactions.unshift({ type: "RETAIL_LICENSE", amount: -20, date: new Date() });
            await req.user.save();
            return res.json({ message: "Retail Activated." });
        }
    } catch (err) { res.status(500).json({ error: "Payment error." }); }
});

// ==========================================
// --- 7. TRADING & PUBLIC B2B API ---
// ==========================================
app.get('/api/market/stocks', protect, (req, res) => res.json(stocks));

app.post('/api/trade/execute', protect, async (req, res) => {
    try {
        const { symbol, amount, side } = req.body;
        if (!req.user.hasActiveSubscription || req.user.demoBalance < amount) return res.status(400).json({ error: "Insufficient Access/Funds." });
        
        const win = Math.random() > 0.48;
        const pnl = win ? (amount * 0.1) : -amount;
        req.user.demoBalance += pnl;
        req.user.transactions.unshift({ type: `SIM_${side.toUpperCase()}_${symbol}`, amount: pnl, date: new Date() });
        await req.user.save();
        res.json({ newBalance: req.user.demoBalance });
    } catch (err) { res.status(500).json({ error: "Trade fail." }); }
});

app.post('/api/v1/public/quant-analysis', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        const client = await User.findOne({ b2bKeys: apiKey });
        if (!client) return res.status(401).json({ error: "Invalid API Key." });

        const stock = stocks.find(s => s.symbol.toUpperCase() === req.body.symbol?.toUpperCase());
        if (!stock) return res.status(404).json({ error: "Asset not found." });

        res.json({ status: "SUCCESS", data: { asset: stock.symbol, price: stock.price, momentum: "CALCULATING..." } });
    } catch (err) { res.status(500).json({ error: "API fail." }); }
});

// ==========================================
// --- 8. ADMIN WATCHTOWER ---
// ==========================================
app.get('/api/admin/all-transactions', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "UNAUTHORIZED" });
    try {
        const users = await User.find({}, 'email transactions').lean();
        const feed = users.flatMap(u => u.transactions.map(t => ({ ...t, userEmail: u.email })));
        res.json(feed.sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch (err) { res.status(500).json({ error: "Watchtower fail." }); }
});

app.get('/api/users/profile', protect, (req, res) => {
    res.json({ email: req.user.email, hasActiveSubscription: req.user.hasActiveSubscription, demoBalance: req.user.demoBalance, b2bKeys: req.user.b2bKeys, role: req.user.role });
});

// EXECUTE
app.listen(PORT, "0.0.0.0", () => {
    console.log(`--- [CORE] ENGINE RUNNING ON PORT ${PORT} ---`);
});