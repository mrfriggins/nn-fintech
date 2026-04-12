// FILE: services/payment-service/controllers/paymentController.js
const mongoose = require('mongoose');
const axios = require('axios');
const Wallet = require('../../ledger-service/models/Wallet');
const Transaction = require('../../ledger-service/models/Transaction');

// ==========================================
// HELPER: GET PAYPAL ACCESS TOKEN
// ==========================================
const getPayPalAccessToken = async () => {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
    // Use 'api-m.paypal.com' for live production, 'api-m.sandbox.paypal.com' for testing
    const baseURL = process.env.PAYPAL_MODE === 'live' 
        ? 'https://api-m.paypal.com' 
        : 'https://api-m.sandbox.paypal.com';

    const response = await axios.post(`${baseURL}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    return { token: response.data.access_token, baseURL };
};

// ==========================================
// INITIATE DEPOSIT (Generate Real PayPal Link)
// ==========================================
const initiateDeposit = async (req, res) => {
    try {
        const { amount } = req.body; // e.g., 100

        if (amount < 5) return res.status(400).json({ error: "Minimum deposit amount is $5." });

        const { token, baseURL } = await getPayPalAccessToken();

        // Tell PayPal to create an Order for this amount
        const orderData = {
            intent: "CAPTURE",
            purchase_units: [{
                amount: { currency_code: "USD", value: amount.toString() }
            }]
        };

        const response = await axios.post(`${baseURL}/v2/checkout/orders`, orderData, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // PayPal returns an array of links. We want the 'approve' link where the user goes to pay.
        const checkoutUrl = response.data.links.find(link => link.rel === 'approve').href;

        res.status(200).json({
            message: "PayPal checkout created.",
            orderId: response.data.id, // This is your paymentIntentId
            checkoutUrl: checkoutUrl
        });

    } catch (error) {
        console.error("PayPal Initiate Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to connect to PayPal." });
    }
};

// ==========================================
// CONFIRM DEPOSIT (Capture the Real Funds)
// ==========================================
const confirmDeposit = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { orderId } = req.body;
        const userId = req.user.id;

        const { token, baseURL } = await getPayPalAccessToken();

        // 1. Tell PayPal to actually capture (take) the money from the authorized order
        const captureResponse = await axios.post(`${baseURL}/v2/checkout/orders/${orderId}/capture`, {}, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const captureStatus = captureResponse.data.status;
        const finalAmount = captureResponse.data.purchase_units[0].payments.captures[0].amount.value;

        if (captureStatus !== 'COMPLETED') {
            throw new Error("PayPal payment was not successfully captured.");
        }

        // 2. Find the User's Wallet
        const wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) throw new Error("Wallet not found for this user.");

        // 3. Add the real funds
        wallet.fiatBalance += Number(finalAmount);
        await wallet.save({ session });

        // 4. Create the Ledger Transaction Record
        const transaction = await Transaction.create([{
            senderId: new mongoose.Types.ObjectId(), // System generated ID for external deposits
            receiverId: userId,
            type: 'deposit',
            amount: Number(finalAmount),
            asset: 'USD',
            externalReferenceId: orderId,
            status: 'completed'
        }], { session });

        // 5. Commit the Database Transaction
        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            message: "Real deposit successful! Funds added to wallet.",
            newBalance: wallet.fiatBalance,
            transaction: transaction[0]
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error("PayPal Capture Error:", error.response?.data || error.message);
        res.status(400).json({ error: error.message || "Failed to confirm deposit." });
    }
};

module.exports = {
    initiateDeposit,
    confirmDeposit
};