const config = require('../config');
const { MongoClient } = require('mongodb');

const MONGO_URI = config.('mongo.uri');
const DB_NAME = config.('mongo.dbName');
const OPTIONS = config.('mongo.options');

const client = new MongoClient(MONGO_URI, OPTIONS);

async function connectDb() {
    if (!client.topology?.isConnected()) {
        await client.connect();
    }
    return client.db(DB_NAME);
}

module.exports = { connectDb };
