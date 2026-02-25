require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function listUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const User = require('../models/User');
        const users = await User.find({}).select('email fullName role isActive createdAt');

        if (users.length === 0) {
            console.log('⚠️  No users found in the database.');
        } else {
            console.log(`Found ${users.length} user(s):\n`);
            users.forEach((u, i) => {
                console.log(`${i + 1}. Email    : ${u.email}`);
                console.log(`   Name     : ${u.fullName}`);
                console.log(`   Role     : ${u.role}`);
                console.log(`   Active   : ${u.isActive}`);
                console.log(`   Created  : ${u.createdAt?.toISOString()}`);
                console.log('');
            });
        }
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

listUsers();
