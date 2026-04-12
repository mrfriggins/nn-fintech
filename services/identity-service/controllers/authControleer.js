const bcrypt = require('bcrypt');
const User = require('../models/User');
const generateToken = require('../../../shared/generateToken');


const registerUser = async (req, res) => {
    try{
        const { email, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if(existingUser){
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create the user in the database
        const user = await User.create({
            email,
            password: hashedPassword,
            role: 'user' // Defaults to standard user
        });

        // Generate JWT token
        const token = generateToken(user._id, user.role);

        // Return success
        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                kycStatus: user.kycStatus
            },
            token
        });
    }  catch(error){
        res.status(500).json({ message: 'Error registering user', error: error.message });

    }
};

const loginUser = async (req, res) => {
    try{
        const { email, password } = req.body;

        // Find the user by email
        const user = await User.findOne({ email });
        if(!user){
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // Compare the password
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch){
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = generateToken(user._id, user.role);

        // Return success
        res.status(200).json({
            message: 'User logged in successfully',
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                kycStatus: user.kycStatus
            },
            token
        });
    } catch(error){
        res.status(500).json({ message: 'Error logging in user', error: error.message });
    }
};

module.exports = {
    registerUser,
    loginUser
};