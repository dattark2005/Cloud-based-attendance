require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
console.log('Testing connection to:', uri.replace(/:([^:@]{1,})@/, ':****@')); // Hide password in logs

mongoose.connect(uri)
    .then(() => {
        console.log('Successfully connected!');
        mongoose.connection.close();
    })
    .catch(err => {
        console.error('Connection failed!');
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);
        if (err.cause) console.error('Cause:', err.cause);
    });
