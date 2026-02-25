/**
 * Run: node scripts/reset-password.js
 * Lists all users and resets the ADMIN user's password to "admin123"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Load User model
    const User = require('../models/User');

    // List all users
    const users = await User.find({}).select('email fullName role isActive');
    console.log(`Found ${users.length} user(s):\n`);
    users.forEach((u, i) => {
        console.log(`  ${i + 1}. [${u.role}] ${u.email} — ${u.fullName} (active: ${u.isActive})`);
    });

    if (users.length === 0) {
        console.log('\n⚠️  No users found. Creating default admin...');
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash('admin123', salt);
        await User.create({
            email: 'admin@attendance.com',
            password: hashed,
            fullName: 'System Admin',
            role: 'ADMIN',
            isActive: true,
        });
        console.log('\n✅ Admin created:');
        console.log('   Email   : admin@attendance.com');
        console.log('   Password: admin123');
    } else {
        // Reset the first ADMIN user's password
        const admin = users.find(u => u.role === 'ADMIN') || users[0];
        const salt = await bcrypt.genSalt(10);
        const hashed = await bcrypt.hash('admin123', salt);
        await User.findByIdAndUpdate(admin._id, { password: hashed });
        console.log(`\n✅ Password reset for: ${admin.email}`);
        console.log('   New password: admin123');
    }

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
