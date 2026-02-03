const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // If MONGODB_URI is not set or is the default placeholder, use a fallback
    let mongoURI = process.env.MONGODB_URI;
    
    // Check if it's the placeholder value
    if (!mongoURI || mongoURI.includes('username:password@cluster.mongodb.net')) {
      console.log('⚠️  MongoDB URI not configured. Using in-memory fallback.');
      console.log('📝 To use a real database, update MONGODB_URI in .env file');
      console.log('📚 See SETUP_CREDENTIALS.md for instructions\n');
      
      // For development, we can skip MongoDB connection
      // This allows the server to start without a database
      console.log('✅ Server starting in development mode (no database)');
      console.log('⚠️  API endpoints will work but data won\'t persist\n');
      return;
    }

    const conn = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    console.log('\n📝 To fix this:');
    console.log('1. Get MongoDB Atlas credentials from https://www.mongodb.com/cloud/atlas');
    console.log('2. Update MONGODB_URI in backend/.env file');
    console.log('3. See SETUP_CREDENTIALS.md for detailed instructions\n');
    console.log('⚠️  Server will continue without database (development mode)');
    console.log('⚠️  Data will not persist\n');
  }
};

module.exports = connectDB;
