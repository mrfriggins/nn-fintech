require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.GATEWAY_PORT || 5000;

// Global Middleware
app.use(cors());
// Note: We do NOT use express.json() here. 
// The proxy needs the raw data to forward it directly to the microservices.

// ==========================================
// MICROSERVICE ROUTING MAP
// ==========================================

// 1. Identity Service (Port 5001)
app.use('/api/auth', createProxyMiddleware({ target: 'http://localhost:5001', changeOrigin: true }));
app.use('/api/kyc', createProxyMiddleware({ target: 'http://localhost:5001', changeOrigin: true }));

// 2. Ledger Service (Port 5002)
app.use('/api/wallet', createProxyMiddleware({ target: 'http://localhost:5002', changeOrigin: true }));
app.use('/api/transfer', createProxyMiddleware({ target: 'http://localhost:5002', changeOrigin: true }));

// 3. Payment Service (Port 5003)
app.use('/api/payments', createProxyMiddleware({ target: 'http://localhost:5003', changeOrigin: true }));

// 4. Trading Service (Port 5004)
app.use('/api/trading', createProxyMiddleware({ target: 'http://localhost:5004', changeOrigin: true }));


// Health Check for the Gateway itself
app.get('/health', (req, res) => {
    res.status(200).json({ status: "API Gateway is Online and Routing Traffic." });
});

// Start listening
app.listen(PORT, () => {
    console.log(`🚀 API GATEWAY running on port ${PORT}`);
    console.log(`Routing traffic to microservices...`);
});