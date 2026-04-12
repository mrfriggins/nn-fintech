require('dotenv').config({ path: __dirname + '/../../.env' });
const express = require('express');
const cors = require('cors');


const mongoose = require('mongoose');

// Establish an independent connection pool for this specific microservice
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('[IDENTITY] Dedicated Vault Pipeline Established'))
    .catch(err => console.error('[IDENTITY] Vault Connection Failed:', err.message));

const app = express();
const PORT = process.env.IDENTITY_PORT || 5001;
// Middleware
app.use(cors());
app.use(express.json());
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/kyc', require('./routes/kyc'));

//  Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Identity Service is healthy' });
});

// Start listening
app.listen(PORT, () => {
    console.log(`Identity Service running on port ${PORT}`);
});