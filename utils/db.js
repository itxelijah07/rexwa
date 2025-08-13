
const { MongoClient } = require('mongodb');
const config = require('../config');
const logger = require('../Core/logger');

let client;
let db;

async function connectDb() {
    if (db) return db;

    // Try to get URI from config or environment
    const uri = config.get('mongo.uri') || process.env.MONGO_URI;
    if (!uri) {
        throw new Error('MongoDB URI is not set in config or environment');
    }

    const dbName = config.get('mongo.dbName') || process.env.MONGO_DB || 'hyperwa';

    try {
        client = new MongoClient(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        await client.connect();
        db = client.db(dbName);
        logger.info(`✅ Connected to MongoDB database: ${dbName}`);
        return db;
    } catch (err) {
        logger.error('❌ MongoDB connection error:', err.message);
        throw err;
    }
}

async function closeDb() {
    if (client) {
        await client.close();
        logger.info('🔌 MongoDB connection closed');
        client = null;
        db = null;
    }
}

module.exports = { connectDb, closeDb };
