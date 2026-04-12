const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
        minlength: 8,
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },


    kycStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'none'],
        default: 'none',
    },


    aiAutoTradeEnabled: {
        type: Boolean,
        default: false },
        aiRiskTolerance: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium' },
        aiTradeFrequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        default: 'weekly' },
},  { timestamps: true });

module.exports = mongoose.model('User', userSchema
);