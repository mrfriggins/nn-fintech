const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            family: 4, // <-- THIS IS THE IPV4 ROUTING OVERRIDE
            serverSelectionTimeoutMS: 5000
        });
        console.log('MongoDB Vault Connected');
    } catch (error) {
        console.error('Database connection failed:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;