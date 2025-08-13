// utils/mongoAuthState.js
const { initAuthCreds } = require('@whiskeysockets/baileys');
const { connectDb } = require('./db');
const logger = require('../Core/logger');

/**
 * Fully MongoDB-backed authentication state for Baileys
 * - No file system usage (no auth_info/, no creds.json, no keys/)
 * - Stores session in a single document in the 'session' collection
 * - Automatically clears corrupted or logged-out sessions
 * - Never expires unless manually deleted
 */

const SESSION_ID = 'auth'; // Single document to store all auth data

class MongoAuthState {
    constructor(db) {
        this.db = db;
        this.sessionCollection = db.collection('session');
    }

    /**
     * Load credentials from MongoDB
     */
    async loadCreds() {
        const record = await this.sessionCollection.findOne({ _id: SESSION_ID });
        if (!record || !record.creds) {
            logger.info('🔐 No active session found in MongoDB. A new session will be created upon connection.');
            return null;
        }

        // Basic integrity check
        const { creds } = record;
        if (
            !creds.noiseKey ||
            !creds.signedIdentityKey ||
            !creds.signedPreKey ||
            !creds.registrationId
        ) {
            logger.warn('⚠️  Corrupted session detected (missing critical keys). Clearing...');
            await this.clear();
            return null;
        }

        return creds;
    }

    /**
     * Save credentials to MongoDB
     */
    async saveCreds(creds) {
        await this.sessionCollection.updateOne(
            { _id: SESSION_ID },
            {
                $set: {
                    creds,
                    updated_at: new Date(),
                },
                $setOnInsert: {
                    created_at: new Date(),
                },
            },
            { upsert: true }
        );
    }

    /**
     * Get a signal key by ID
     */
    async get(key) {
        const result = await this.sessionCollection.findOne(
            { _id: SESSION_ID },
            { projection: { [`signal_keys.${key}`]: 1 } }
        );

        const data = result?.signal_keys?.[key];
        return data ? Buffer.from(JSON.stringify(data)) : undefined;
    }

    /**
     * Set multiple signal keys
     */
    async set(data) {
        const updateObj = {};
        for (const [k, v] of Object.entries(data)) {
            try {
                updateObj[`signal_keys.${k}`] = JSON.parse(v.toString('utf8'));
            } catch (err) {
                logger.warn(`⚠️ Failed to parse signal key "${k}":`, err.message);
            }
        }

        await this.sessionCollection.updateOne(
            { _id: SESSION_ID },
            {
                $set: {
                    ...updateObj,
                    updated_at: new Date(),
                },
                $setOnInsert: {
                    created_at: new Date(),
                },
            },
            { upsert: true }
        );
    }

    /**
     * Clear the entire session (use on logout or corruption)
     */
    async clear() {
        const result = await this.sessionCollection.deleteOne({ _id: SESSION_ID });
        if (result.deletedCount > 0) {
            logger.info('🗑️  WhatsApp session successfully removed from MongoDB');
        } else {
            logger.warn('🗑️  No session found to delete in MongoDB');
        }
    }
}

/**
 * Main function to use MongoDB-only auth state
 * @returns {Object} { state: { creds, keys }, saveCreds: Function, clear: Function }
 */
async function useMongoAuthState() {
    let db;
    try {
        db = await connectDb();
    } catch (err) {
        logger.error('❌ Failed to connect to MongoDB:', err.message);
        throw new Error('Unable to initialize authentication: Database connection failed.');
    }

    const authState = new MongoAuthState(db);

    // Load existing credentials
    let creds = await authState.loadCreds();

    if (!creds) {
        logger.info('🆕 Creating fresh WhatsApp authentication session...');
        creds = initAuthCreds(); // Baileys built-in function to generate new creds
        await authState.saveCreds(creds);
    }

    return {
        state: {
            creds,
            keys: {
                get: (key) => authState.get(key),
                set: (data) => authState.set(data),
            },
        },
        saveCreds: async () => {
            await authState.saveCreds(creds);
        },
        // Exported for external use (e.g., logout)
        clear: () => authState.clear(),
    };
}

module.exports = { useMongoAuthState };
