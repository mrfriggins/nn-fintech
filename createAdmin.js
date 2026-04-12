const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// 1. The Blueprint (Must match your server.js schema)
const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    balance: { type: Number, default: 1000000.00 }, // Admin starts with 1M
    transactions: Array
});

const User = mongoose.model('User', userSchema);

async function forceCreateAdmin() {
    try {
        // Connect to your MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to Vault...");

        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;

        // Check if admin exists
        const existing = await User.findOne({ email: adminEmail });
        if (existing) {
            console.log("Admin already exists. Deleting old record for clean reset...");
            await User.deleteOne({ email: adminEmail });
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        // Create the God-Account
        const admin = new User({
            email: adminEmail,
            password: hashedPassword,
            role: "admin",
            transactions: [{ type: "System Initialization", amount: 1000000 }]
        });

        await admin.save();
        console.log("--------------------------------------------------");
        console.log(`SUCCESS: ADMIN CREATED`);
        console.log(`EMAIL: ${adminEmail}`);
        console.log(`ROLE: admin`);
        console.log("--------------------------------------------------");
        
        process.exit();
    } catch (err) {
        console.error("OVERRIDE FAILED:", err);
        process.exit(1);
    }
}

forceCreateAdmin();