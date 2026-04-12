require('dotenv').config({ path: '../../.env' });
const express = require('express');
const cors = require('cors');

// Import the shared MongoDB connection
const connectDB = require('../../shared/db');

// Initialize database connection
connectDB();

const app = express();
const PORT = process.env.PAYMENT_PORT || 5003;

// Middleware
app.use(cors());
app.use(express.json());

// ===============================================
// MOUNT ROUTES
// ===============================================
app.use('/api/payments/deposit', require('./routes/deposit'));
app.use('/api/payments/withdraw', require('./routes/adminWithdraw'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'Payment service is healthy' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`Payment service running on port ${PORT}`);
});