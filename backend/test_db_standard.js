require('dotenv').config();
const mongoose = require('mongoose');

// Construct standard URI (bypassing SRV)
// derived from: ac-owzuf5d-shard-00-00.4wdza5e.mongodb.net
const standardUri = 'mongodb://dattatraykshirsagar23_db_user:czDez2VR0UZty1VV@ac-owzuf5d-shard-00-00.4wdza5e.mongodb.net:27017/?ssl=true&authSource=admin';

console.log('Testing connection to standard URI...');

mongoose.connect(standardUri)
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
