const configPromise = require('../config'); // This is a Promise from your Config class
const { MongoClient } = require('mongodb');

let client; // Will hold the MongoDB client instance

async function connectDb() {
    // Wait for config to finish loading
    const config = await configPromise;

    const MONGO_URI = config.get('mongo.uri');
    const DB_NAME = config.get('mongo.dbName');
    const OPTIONS = config.get('mongo.options') || {};

    // Create the client if it doesn't exist yet
    if (!client) {
        client = new MongoClient(MONGO_URI, OPTIONS);
    }

    // Connect if not connected
    if (!client.topology?.isConnected()) {
        await client.connect();
    }

    return client.db(DB_NAME);
}

module.exports = { connectDb };
