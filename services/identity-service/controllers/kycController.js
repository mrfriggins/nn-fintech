const KYC = require('../models/KYC');
import User from '../models/User';

//=============================================================
// Submit KYC Information
//=====================================================================
const  submitKYC = async (req, res) => {
    try{
        //req.user comes from your JWT Gateway Middleware!
        const userId = req.user.id;
        const { documentType, documentUrl } =  req.body;

        
        const existingKyc = await KYC.findOne({ userId });
        if (existingKyc && existingKyc.status === 'pending') {
            return
            res.status(400).json({ error: "Your KYC is already under review" });
        }

        const kycRecord = await
        KYC.findOneAndUpdate(
            { userId },
            { documentType, documentUrl, status: 'pending' },
            { new: true, upsert: true }
        );

        await
        User.findByIdAndUpdate(userId, { kycStatus: 'pending' });

        res.status(201).json({ message: "KYC documents subitted successfully", kycRecord });

    } catch (error) {
        console.error("KYC Submission Error:", error);
        res.status(500).json({ error: "Internal server error during KYC submission." });
    }
};

//=============================================================
//UPDATE KYC STATUS (Webhook from provider or Admin)
//=====================================================================
const updateKYCStatus = async (req, res) => {
    try{
        const { userId, status, providerId, rejectionReason } = req.body;


        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: "Invalid KYC status update." });
        }

        const kycRecord = await KYC.findOneAndUpdate(
            { userId },
            { status, providerId, rejectionReason },
            { new: true }
        );
        if (!kycRecord) {
            return res.status(404).json({ error: "KYC record not found for the user." });
        }

        await User.findByIdAndUpdate(userId, { kycStatus: status });

        res.status(200).json({ message: `User KYC status updated successfully to ${status}` });
    } catch (error) {
        console.error("KYC Status Update Error:", error);
        res.status(500).json({ error: "Internal server error during KYC status update." });
    }
};

module.exports = {
    submitKYC,
    updateKYCStatus
};