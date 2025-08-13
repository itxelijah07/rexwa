// utils/db.js
const config = require('../config');
const { MongoClient } = require('mongodb');

const MONGO_URI = config.mongo?.uri || process.env.MONGO_URI;
const DB_NAME = config.mongo?.dbName || process.env.MONGO_DB_NAME || 'hyperwa';
const OPTIONS = config.mongo?.options || {};

if (!MONGO_URI) {
    console.error('❌ MongoDB URI is missing! Set it in config.js or MONGO_URI env variable.');
    process.exit(1);
}

const client = new MongoClient(MONGO_URI, OPTIONS);

async function connectDb() {
    try {
        if (!client.topology?.isConnected()) {
            await client.connect();
        }
        return client.db(DB_NAME);
    } catch (err) {
        console.error('❌ Failed to connect to MongoDB:', err);
        throw err;
    }
}

module.exports = { connectDb };
