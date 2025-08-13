// utils/db.js
const config = require('../config');
const { MongoClient } = require('mongodb');

let client; // Keep one instance across imports

async function connectDb() {
    if (!client) {
        const uri = config.get('mongo.uri');
        const dbName = config.get('mongo.dbName');

        if (!uri || !dbName) {
            throw new Error('❌ MongoDB URI or DB name is missing from config');
        }

        client = new MongoClient(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        await client.connect();
        console.log('✅ MongoDB connected');
    }

    return client.db(config.get('mongo.dbName'));
}

module.exports = { connectDb };
