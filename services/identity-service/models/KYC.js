const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
    userId: { type:
        mongoose.Schema.Types.ObjectId, ref:
        'User', required: true, unique: true },
        documentType: { type: String,
            enum: ['passport', 'driver_license', 'id_card'], required: true },

            documentUrl: { type: String, required: true },  //  Secure cloud URL for the uploaded document
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    providerId: { type: String },  // ID from the KYC provider for tracking
    rejectionReason: { type: String },  // Reason for rejection if status is 'rejected'
}, { timestamps: true });

module.exports = mongoose.model('KYC', kycSchema);