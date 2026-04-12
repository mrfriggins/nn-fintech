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
const PORT = 8080;
// GLOBAL MIDDLEWARE MUST BE HERE
app.use(cors({
  origin: [
    'https://nn-fintech.com', 
    'https://www.nn-fintech.com', 
    'http://localhost:3000'
  ], 
  credentials: true
}));
app.use(express.json());

// ==========================================
// --- 1. EMAIL TRANSMITTER (NODEMAILER) ---
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_APP_PASSWORD 
    },
    tls: {
        // OVERRIDE: Bypasses local antivirus/network SSL interception
        rejectUnauthorized: false 
    }
});


// ==========================================
// --- 2. DATABASE (SAAS ENTERPRISE MODEL) ---
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("--- [SYSTEM] SAAS VAULT ONLINE ---"))
    .catch(err => { console.error("!!! DB FATAL ERROR !!!", err); process.exit(1); });

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    
    // --- OTP FIREWALL ---
    isVerified: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },

    // --- SAAS PAYWALL ---
    hasActiveSubscription: { type: Boolean, default: false }, 
    demoBalance: { type: Number, default: 0.00 },             
    
    // --- ENTERPRISE B2B KEYS ---
    b2bKeys: [{ type: String }], 
    
    // --- CRYPTO SECURITY WALL ---
    usedCryptoTxIds: [{ type: String }], 
    
    transactions: [{ type: Object }]
});
const User = mongoose.model('User', userSchema);

// ==========================================
// --- 3. GLOBAL MARKET ENGINE (POLYGON) ---
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
    for (let i = 0; i < 4; i++) {
        const s = stocks[syncIndex];
        try {
            const response = await fetch(`https://api.polygon.io/v2/aggs/ticker/${s.ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`);
            if (response.ok) {
                const data = await response.json();
                if (data.results && data.results.length > 0) {
                    stocks[syncIndex].anchorPrice = data.results[0].c; 
                    if (Math.abs(stocks[syncIndex].price - data.results[0].c) > (data.results[0].c * 0.05)) {
                        stocks[syncIndex].price = data.results[0].c;
                    }
                }
            }
        } catch (e) {}
        syncIndex = (syncIndex + 1) % stocks.length;
    }
};
syncPolygonData();
setInterval(syncPolygonData, 60000);

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
    let token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access Denied." });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (!user) return res.status(403).json({ error: "RESTRICTED" });
        req.user = user;
        next();
    } catch (err) { return res.status(401).json({ error: "Session Expired" }); }
};

// ==========================================
// --- 5. AUTHENTICATION & OTP FIREWALL ---
// ==========================================
app.post('/auth/register', async (req, res) => {
    try {
        // FORCE CLEAN THE INPUT
        const email = req.body.email.trim().toLowerCase();
        const password = req.body.password;
        
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: "Email already exists in the system." });

        const hashed = await bcrypt.hash(password, 10);
        
        const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const expirationTime = new Date(Date.now() + 10 * 60000); 

        const newUser = new User({ 
            email, 
            password: hashed, 
            otp: generatedOtp, 
            otpExpires: expirationTime 
        });
        await newUser.save();

        await transporter.sendMail({
            from: `"NN-Fintech Vault" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Your Access Code",
            text: `Your authorization code is: ${generatedOtp}\n\nThis code expires in 10 minutes. Do not share it.`
        });

        res.status(201).json({ message: "Verification code sent. Check your email." });
    } catch (err) { 
        console.error("--- REGISTRATION CRASH LOG ---", err); 
        res.status(500).json({ error: "Registration sequence failed." }); 
    }
});

app.post('/auth/verify', async (req, res) => {
    try {
        // FORCE CLEAN THE INPUT
        const email = req.body.email.trim().toLowerCase();
        const otp = req.body.otp;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.isVerified) return res.status(400).json({ error: "Account is already active." });

        if (user.otp !== otp || user.otpExpires < new Date()) {
            return res.status(400).json({ error: "INVALID OR EXPIRED CODE. ACCESS DENIED." });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: "Account Verified. Logging in.", token, role: user.role, hasActiveSubscription: user.hasActiveSubscription });
    } catch (err) { res.status(500).json({ error: "Verification failure." }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        // FORCE CLEAN THE INPUT
        const identifier = req.body.identifier.trim().toLowerCase();
        const password = req.body.password;
        
        const user = await User.findOne({ email: identifier });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: "Invalid Credentials." });
        }
        
        if (!user.isVerified) {
            return res.status(403).json({ error: "ACCOUNT LOCKED: You must verify your email first." });
        }

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, hasActiveSubscription: user.hasActiveSubscription });
    } catch (err) { 
        console.error("--- LOGIN CRASH LOG ---", err);
        res.status(500).json({ error: "Server Error." }); 
    }
});

// ==========================================
// --- 6. AUTOMATED CRYPTO CHECKOUT ENGINE ---
// ==========================================
app.post('/api/payment/verify-crypto', protect, async (req, res) => {
    try {
        const { txId, tier } = req.body;
        if (!txId || !tier) return res.status(400).json({ error: "Missing TxID or Tier." });

        const isB2B = tier === "B2B";
        const EXPECTED_VALUE = isB2B ? 500000000 : 20000000; 

        const User = mongoose.model('User');
        const existingClaim = await User.findOne({ usedCryptoTxIds: txId });
        if (existingClaim) return res.status(403).json({ error: "FRAUD DETECTED: TxID already claimed." });

        const MASTER_WALLET = process.env.MASTER_CRYPTO_WALLET.toLowerCase();
        const USDT_CONTRACT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F".toLowerCase(); 

        const scanUrl = `https://api.etherscan.io/v2/api?chainid=137&module=account&action=tokentx&address=${MASTER_WALLET}&page=1&offset=100&startblock=0&endblock=99999999&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
        const response = await fetch(scanUrl);
        const data = await response.json();

        if (data.status !== "1" || !data.result) return res.status(500).json({ error: "Blockchain auditor offline." });

        const transaction = data.result.find(tx => tx.hash.toLowerCase() === txId.toLowerCase());

        if (!transaction) return res.status(404).json({ error: "TRANSACTION NOT FOUND." });
        if (transaction.to.toLowerCase() !== MASTER_WALLET) return res.status(400).json({ error: "FUNDS NOT SENT TO CORPORATE VAULT." });
        if (transaction.contractAddress.toLowerCase() !== USDT_CONTRACT) return res.status(400).json({ error: "INVALID ASSET. Send USDT." });
        if (parseInt(transaction.value) < EXPECTED_VALUE) return res.status(400).json({ error: `INSUFFICIENT FUNDS. Expected $${EXPECTED_VALUE / 1000000}.` });

        req.user.usedCryptoTxIds.push(txId);

        if (isB2B) {
            const newApiKey = "nn_prod_" + crypto.randomBytes(16).toString('hex');
            req.user.b2bKeys.push(newApiKey);
            req.user.transactions.unshift({
                type: "B2B_API_LICENSE", amount: -500, date: new Date(), txId: txId, generatedKey: newApiKey
            });

            try {
                await transporter.sendMail({
                    from: `"NN-Fintech Enterprise" <${process.env.EMAIL_USER}>`,
                    to: req.user.email,
                    subject: "Your NN-Fintech B2B API Key",
                    text: `Welcome to the Enterprise Tier.\n\nYour B2B Quant Engine API Key is: \n\n${newApiKey}\n\nDocumentation: POST to https://your-domain/api/v1/public/quant-analysis with this key in the 'x-api-key' header.\n\nKeep this key strictly confidential.`
                });
            } catch(e) { console.error("Email dispatcher failed", e); }

            await req.user.save();
            return res.json({ message: "B2B PAYMENT VERIFIED. API Key sent to your email." });

        } else {
            req.user.hasActiveSubscription = true;
            req.user.demoBalance = 100000;
            req.user.transactions.unshift({
                type: "RETAIL_LICENSE_PURCHASE", amount: -20, date: new Date(), txId: txId
            });
            await req.user.save();
            return res.json({ message: "RETAIL PAYMENT VERIFIED. Terminal Unlocked." });
        }

    } catch (err) { res.status(500).json({ error: "VERIFICATION FAILURE." }); }
});

app.get('/api/users/profile', protect, (req, res) => {
    res.json({
        email: req.user.email,
        hasActiveSubscription: req.user.hasActiveSubscription,
        demoBalance: req.user.demoBalance,
        b2bKeys: req.user.b2bKeys,
        role: req.user.role
    });
});

// ==========================================
// --- 7. SIMULATION TRADING ENGINE ---
// ==========================================
app.get('/api/market/stocks', protect, (req, res) => { res.json(stocks); });

app.post('/api/trade/execute', protect, async (req, res) => {
    try {
        const { symbol, amount, side } = req.body;
        if (!req.user.hasActiveSubscription) return res.status(403).json({ error: "SUBSCRIPTION REQUIRED." });
        const val = parseFloat(amount);
        if (val <= 0 || req.user.demoBalance < val) return res.status(400).json({ error: "INSUFFICIENT CAPITAL." });

        const win = Math.random() > 0.48;
        const pnl = win ? (val * ((Math.random() * 0.15) + 0.01)) : -val;
        req.user.demoBalance += pnl;
        req.user.transactions.unshift({ type: `SIMULATED_${side.toUpperCase()}: ${symbol}`, amount: pnl, date: new Date() });
        await req.user.save();
        res.json({ message: "ORDER FILLED.", newBalance: req.user.demoBalance });
    } catch (err) { res.status(500).json({ error: "ENGINE FAILURE." }); }
});

// ==========================================
// --- 8. B2B PUBLIC QUANT API (THE PRODUCT) ---
// ==========================================
app.post('/api/v1/public/quant-analysis', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) return res.status(401).json({ error: "UNAUTHORIZED: Missing API Key." });

        const client = await mongoose.model('User').findOne({ b2bKeys: apiKey });
        if (!client) return res.status(401).json({ error: "UNAUTHORIZED: Invalid API Key. License terminated or invalid." });

        const { symbol } = req.body;
        if (!symbol) return res.status(400).json({ error: "Missing required parameter: 'symbol'" });

        const stock = stocks.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
        if (!stock) return res.status(404).json({ error: "Asset not tracked." });

        const spread = ((stock.price - stock.anchorPrice) / stock.anchorPrice) * 100;
        let momentum = "NEUTRAL";
        if (spread < -0.1) momentum = "HIGH_PROBABILITY_UPTREND";
        else if (spread > 0.1) momentum = "HIGH_PROBABILITY_DOWNTREND";

        res.json({
            status: "SUCCESS",
            data: {
                asset: stock.symbol, currentSimulationPrice: stock.price, institutionalAnchorPrice: stock.anchorPrice,
                volatilitySpread: spread.toFixed(4) + "%", algorithmicMomentum: momentum, timestamp: new Date().toISOString()
            },
            disclaimer: "Data is generated by automated algorithms for informational purposes."
        });

    } catch (err) { res.status(500).json({ error: "API FAILURE." }); }
});

// ==========================================
// --- 9. ADMIN HQ (THE WATCHTOWER) ---
// ==========================================
app.get('/api/admin/all-transactions', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "UNAUTHORIZED" });
    try {
        const allUsers = await User.find({}, 'email transactions').lean() || [];
        let masterFeed = [];
        allUsers.forEach(u => {
            if (Array.isArray(u.transactions)) {
                u.transactions.forEach(t => masterFeed.push({ ...t, userEmail: u.email }));
            }
        });
        masterFeed.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(masterFeed);
    } catch (err) { res.status(500).json({ error: "Failed to compile tape." }); }
});

app.listen(PORT, () => console.log(`--- [CORE] SAAS ENGINE ACTIVE ON 127.0.0.1:${PORT} ---`));