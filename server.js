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
    fullName: { type: String },
    country: { type: String },
    role: { type: String, default: "user" },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    otp: { type: String },
    otpExpires: { type: Date },
    
    // Subscriptions
    subscriptionTier: { type: String, enum: ['none', 'retail_20', 'b2b_500'], default: 'none' },
    subscriptionExpiry: { type: Date, default: null },
    demoBalance: { type: Number, default: 0.00 },
    
    // B2B Infrastructure
    b2bKey: { type: String, default: null },
    allowedOrigin: { type: String, default: null },
    clientPolygonKey: { type: String, default: null }
});
const User = mongoose.model('User', userSchema);

// --- 3. AUTOMATED SUBSCRIPTION LIFECYCLE ---
cron.schedule('0 0 * * *', async () => {
    console.log("[SYSTEM] Executing daily subscription sweep...");
    const now = new Date();
    
    await User.updateMany(
        { subscriptionExpiry: { $lt: now }, subscriptionTier: { $ne: 'none' } },
        { $set: { subscriptionTier: 'none', b2bKey: null } }
    );

    const oneWeekOutStart = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const oneWeekOutEnd = new Date(oneWeekOutStart.getTime() + 24 * 60 * 60 * 1000);
    
    const warningUsers = await User.find({
        subscriptionExpiry: { $gte: oneWeekOutStart, $lt: oneWeekOutEnd },
        subscriptionTier: { $ne: 'none' }
    });

    warningUsers.forEach(user => {
        console.log(`[SYSTEM] Dispatching 7-day warning email to ${user.email}`);
    });
});

// --- 4. THE IN-BUILT AI (MATH ALGORITHM) ---
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

// --- 5. RETAIL SIMULATOR ($20 DEMO TIER - INSTITUTIONAL ASSETS) ---
const retailAssets = [
    // Crypto
    { symbol: "BTC/USD", price: 68400, volatility: 0.005 },
    { symbol: "ETH/USD", price: 3450, volatility: 0.008 },
    { symbol: "SOL/USD", price: 145.20, volatility: 0.012 },
    { symbol: "XRP/USD", price: 0.61, volatility: 0.010 },
    { symbol: "ADA/USD", price: 0.45, volatility: 0.015 },
    { symbol: "DOT/USD", price: 8.50, volatility: 0.011 },
    // Forex
    { symbol: "EUR/USD", price: 1.0850, volatility: 0.0002 },
    { symbol: "GBP/USD", price: 1.2630, volatility: 0.0003 },
    { symbol: "USD/JPY", price: 151.20, volatility: 0.001 },
    { symbol: "AUD/USD", price: 0.6540, volatility: 0.0004 },
    { symbol: "USD/CAD", price: 1.3520, volatility: 0.0003 },
    { symbol: "USD/CHF", price: 0.9050, volatility: 0.0003 },
    // Indices
    { symbol: "SPY", price: 520.15, volatility: 0.002 },
    { symbol: "QQQ", price: 445.30, volatility: 0.003 },
    { symbol: "DIA", price: 395.10, volatility: 0.0015 },
    { symbol: "IWM", price: 205.40, volatility: 0.0025 },
    // Commodities
    { symbol: "GOLD", price: 2350.00, volatility: 0.004 },
    { symbol: "SILVER", price: 28.50, volatility: 0.006 },
    { symbol: "USOIL", price: 82.40, volatility: 0.008 },
    { symbol: "UKOIL", price: 86.90, volatility: 0.007 },
    // Equities
    { symbol: "AAPL", price: 172.50, volatility: 0.003 },
    { symbol: "TSLA", price: 175.20, volatility: 0.009 },
    { symbol: "MSFT", price: 425.10, volatility: 0.0025 },
    { symbol: "NVDA", price: 885.00, volatility: 0.006 }
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

// --- 7. AUTHENTICATION & IDENTITY ---
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

        console.log(`[SECURITY] OTP for ${email} is: ${otp}`);

        res.status(201).json({ message: "OTP Dispatched." });
    } catch (err) { res.status(500).json({ error: "Server error." }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email?.trim()?.toLowerCase() });

        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: "Invalid credentials." });
        if (!user.isVerified) return res.status(403).json({ error: "Verify email first." });
        if (!user.isActive) return res.status(403).json({ error: "Account Suspended." });

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, subscriptionTier: user.subscriptionTier });
    } catch (err) { res.status(500).json({ error: "Login failed." }); }
});

app.post('/auth/verify', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await User.findOne({ email: email?.trim()?.toLowerCase() });

        if (!user || user.otp !== otp || user.otpExpires < new Date()) {
            return res.status(400).json({ error: "Invalid or Expired OTP." });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, role: user.role, subscriptionTier: user.subscriptionTier });
    } catch (err) { res.status(500).json({ error: "Verification failed." }); }
});

app.get('/api/users/profile', protect, (req, res) => {
    res.json({ 
        email: req.user.email, 
        subscriptionTier: req.user.subscriptionTier, 
        demoBalance: req.user.demoBalance, 
        role: req.user.role 
    });
});

// --- 8. RETAIL ENDPOINTS ($20 TIER) ---
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

// --- 9. AUTOMATED CRYPTO BILLING (NOWPAYMENTS) ---
app.post('/api/payment/create-invoice', protect, async (req, res) => {
    const { tier } = req.body;
    let priceAmount = 0;
    
    if (tier === 'RETAIL') priceAmount = 20;
    else if (tier === 'B2B') priceAmount = 500;
    else return res.status(400).json({ error: "Invalid tier." });

    try {
        const response = await fetch('https://api.nowpayments.io/v1/invoice', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                price_amount: priceAmount,
                price_currency: "usd",
                pay_currency: "usdtmatic", // Forced to Polygon USDT
                order_id: `${req.user._id}_${tier}_${Date.now()}`,
                order_description: `NN-Fintech ${tier} License`,
                ipn_callback_url: "https://nn-fintech.onrender.com/api/payment/webhook" // Hardcoded Production Webhook
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Gateway failed.");

        res.json({ 
            invoice_id: data.id, 
            pay_address: data.pay_address, 
            pay_amount: data.pay_amount,
            pay_currency: data.pay_currency,
            invoice_url: data.invoice_url
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate crypto invoice." });
    }
});

app.post('/api/payment/webhook', async (req, res) => {
    const sig = req.headers['x-nowpayments-sig'];
    if (!sig) return res.status(403).json({ error: "Missing signature." });

    const hmac = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET);
    hmac.update(JSON.stringify(req.body, Object.keys(req.body).sort()));
    const signature = hmac.digest('hex');

    if (signature !== sig) return res.status(403).json({ error: "Invalid signature." });

    const { payment_status, order_id } = req.body;
    
    if (payment_status === 'finished' || payment_status === 'confirmed') {
        const [userId, tier] = order_id.split('_');
        const user = await User.findById(userId);
        
        if (user) {
            user.subscriptionTier = tier === 'B2B' ? 'b2b_500' : 'retail_20';
            user.subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
            
            if (tier === 'B2B' && !user.b2bKey) {
                user.b2bKey = "nn_api_" + crypto.randomBytes(32).toString('hex');
            }
            if (tier === 'RETAIL') {
                user.demoBalance = 10000; 
            }
            
            await user.save();
            console.log(`[FINANCE] Payment verified. ${user.email} upgraded to ${tier}.`);
        }
    }
    
    res.status(200).send("OK");
});

// --- 10. B2B EXTERNAL API ($500 TIER - BYOK LIVE DATA) ---
app.get('/v1/b2b/market-stream', b2bGateway, async (req, res) => {
    try {
        if (!req.b2bClient.clientPolygonKey) return res.status(400).json({ error: "No Polygon API key linked to account." });
        
        const activeKey = decryptKey(req.b2bClient.clientPolygonKey);
        const tickers = ["X:BTCUSD", "X:ETHUSD", "C:EURUSD"];
        
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

// --- 11. GOD-MODE ADMIN GATEWAY ---

app.get('/api/admin/users', protect, requireGodMode, async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ _id: -1 });
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch users." });
    }
});

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