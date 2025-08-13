const { proto } = require("@whiskeysockets/baileys");
const { connectDb } = require("./db");
const logger = require('../Core/logger');

async function useMongoAuthState() {
    const db = await connectDb();
    const authCollection = db.collection("auth_session");
    
    // Initialize collections with indexes
    await authCollection.createIndex({ type: 1 });
    
    logger.info('🔧 Using MongoDB auth state...');

    // Load existing auth data
    const [credsDoc, keysDoc] = await Promise.all([
        authCollection.findOne({ type: 'creds' }),
        authCollection.findOne({ type: 'keys' })
    ]);

    const state = {
        creds: credsDoc?.data || undefined,
        keys: keysDoc?.data || {}
    };

    logger.info(`📥 Loaded auth state from MongoDB - Creds: ${!!state.creds}, Keys: ${Object.keys(state.keys).length}`);

    const saveCreds = async () => {
        try {
            // Save credentials
            if (state.creds) {
                await authCollection.updateOne(
                    { type: 'creds' },
                    { 
                        $set: { 
                            type: 'creds',
                            data: state.creds,
                            updatedAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            }

            // Save keys
            if (state.keys && Object.keys(state.keys).length > 0) {
                await authCollection.updateOne(
                    { type: 'keys' },
                    { 
                        $set: { 
                            type: 'keys',
                            data: state.keys,
                            updatedAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            }

            logger.debug('💾 Auth state saved to MongoDB');
        } catch (error) {
            logger.error('❌ Failed to save auth state to MongoDB:', error);
        }
    };

    // Enhanced state object with MongoDB integration
    const enhancedState = {
        creds: state.creds,
        keys: {
            get: (type, ids) => {
                const key = `${type}-${ids.join('-')}`;
                return state.keys[key];
            },
            set: (data) => {
                for (const [key, value] of Object.entries(data)) {
                    state.keys[key] = value;
                }
            }
        }
    };

    return { state: enhancedState, saveCreds };
}

// Clear auth session from MongoDB
async function clearMongoAuthState() {
    try {
        const db = await connectDb();
        const authCollection = db.collection("auth_session");
        await authCollection.deleteMany({});
        logger.info('🗑️ MongoDB auth session cleared');
    } catch (error) {
        logger.error('❌ Failed to clear MongoDB auth session:', error);
        throw error;
    }
}

module.exports = { useMongoAuthState, clearMongoAuthState };