const { connectDb } = require('./db');
const logger = require('../Core/logger');

class MongoConfig {
    constructor() {
        this.db = null;
        this.collection = null;
        this.cache = new Map();
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;
        
        try {
            this.db = await connectDb();
            this.collection = this.db.collection('bot_settings');
            
            // Create indexes for better performance
            await this.collection.createIndex({ key: 1 }, { unique: true });
            
            // Load all settings into cache
            await this.loadAllSettings();
            
            this.initialized = true;
            logger.info('✅ MongoDB config initialized');
        } catch (error) {
            logger.error('❌ Failed to initialize MongoDB config:', error);
            throw error;
        }
    }

    async loadAllSettings() {
        try {
            const settings = await this.collection.find({}).toArray();
            for (const setting of settings) {
                this.cache.set(setting.key, setting.value);
            }
            logger.info(`📥 Loaded ${settings.length} settings from MongoDB`);
        } catch (error) {
            logger.error('❌ Failed to load settings from MongoDB:', error);
        }
    }

    get(key, defaultValue = undefined) {
        if (!this.initialized) {
            logger.warn('⚠️ MongoDB config not initialized, returning default value');
            return defaultValue;
        }

        const keys = key.split('.');
        let value = this.cache.get(keys[0]);
        
        if (value === undefined) {
            return defaultValue;
        }

        // Navigate nested object
        for (let i = 1; i < keys.length; i++) {
            if (value && typeof value === 'object' && keys[i] in value) {
                value = value[keys[i]];
            } else {
                return defaultValue;
            }
        }

        return value;
    }

    async set(key, value) {
        if (!this.initialized) {
            throw new Error('MongoDB config not initialized');
        }

        const keys = key.split('.');
        const rootKey = keys[0];
        
        if (keys.length === 1) {
            // Simple key-value
            this.cache.set(rootKey, value);
            await this.collection.updateOne(
                { key: rootKey },
                { $set: { key: rootKey, value, updatedAt: new Date() } },
                { upsert: true }
            );
        } else {
            // Nested key
            let rootValue = this.cache.get(rootKey) || {};
            let current = rootValue;
            
            // Navigate to parent of target key
            for (let i = 1; i < keys.length - 1; i++) {
                if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
                    current[keys[i]] = {};
                }
                current = current[keys[i]];
            }
            
            // Set the final value
            current[keys[keys.length - 1]] = value;
            
            this.cache.set(rootKey, rootValue);
            await this.collection.updateOne(
                { key: rootKey },
                { $set: { key: rootKey, value: rootValue, updatedAt: new Date() } },
                { upsert: true }
            );
        }

        logger.debug(`💾 Setting saved to MongoDB: ${key}`);
    }

    async update(updates) {
        if (!this.initialized) {
            throw new Error('MongoDB config not initialized');
        }

        for (const [key, value] of Object.entries(updates)) {
            await this.set(key, value);
        }
    }

    async delete(key) {
        if (!this.initialized) {
            throw new Error('MongoDB config not initialized');
        }

        const keys = key.split('.');
        const rootKey = keys[0];

        if (keys.length === 1) {
            this.cache.delete(rootKey);
            await this.collection.deleteOne({ key: rootKey });
        } else {
            let rootValue = this.cache.get(rootKey);
            if (rootValue && typeof rootValue === 'object') {
                let current = rootValue;
                
                // Navigate to parent
                for (let i = 1; i < keys.length - 1; i++) {
                    if (current[keys[i]]) {
                        current = current[keys[i]];
                    } else {
                        return; // Path doesn't exist
                    }
                }
                
                delete current[keys[keys.length - 1]];
                
                this.cache.set(rootKey, rootValue);
                await this.collection.updateOne(
                    { key: rootKey },
                    { $set: { value: rootValue, updatedAt: new Date() } }
                );
            }
        }

        logger.debug(`🗑️ Setting deleted from MongoDB: ${key}`);
    }

    async clear() {
        if (!this.initialized) {
            throw new Error('MongoDB config not initialized');
        }

        this.cache.clear();
        await this.collection.deleteMany({});
        logger.info('🧹 All settings cleared from MongoDB');
    }

    // Get all settings as plain object
    getAll() {
        const result = {};
        for (const [key, value] of this.cache) {
            result[key] = value;
        }
        return result;
    }
}

module.exports = MongoConfig;