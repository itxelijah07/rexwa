const MongoConfig = require('./utils/mongoConfig');

class Config {
    constructor() {
        this.useMongoConfig = false;
        this.mongoConfig = null;
        this.defaultConfig = {
            bot: {
                name: 'HyperWa',
                company: 'Dawium Technologies',
                prefix: '.',
                version: '2.0.0',
                owner: '923075417411@s.whatsapp.net', // Include full JID
                clearAuthOnStart: false
            },

            auth: {
                useMongoAuth: true, // Set to false for file-based auth
                useMongoConfig: true, // Set to false for file-based config
                clearAuthOnStart: false
            },

            admins: [
                '923075417411', // Just the number part, no "@s.whatsapp.net"
                '923334445555'
            ],

            // Feature toggles and options
            features: {
                mode: 'public',                   // 'public' or 'private'
                customModules: true,              // Enable custom modules
                rateLimiting: true,                // Disable rate limiting for better performance
                autoReply: false,                  // Auto reply to messages
                autoViewStatus: false,             // Auto view status updates
                telegramBridge: true,              // Sync with Telegram
                respondToUnknownCommands: false,   // Respond to unknown commands
                sendPermissionError: false         // Send error for disallowed commands
            },

            mongo: {
                uri: 'mongodb+srv://irexanon:xUf7PCf9cvMHy8g6@rexdb.d9rwo.mongodb.net/?retryWrites=true&w=majority&appName=RexDB',
                dbName: 'RexWA'
            },

            telegram: {
                enabled: true,
                botToken: '8340169817:AAE3p5yc0uSg-FOZMirWVu9sj9x4Jp8CCug',
                botPassword: '1122',
                chatId: '-1002846269080',
                logChannel: '-100000000000',
                features: {
                    topics: true,
                    mediaSync: true,
                    profilePicSync: false,
                    callLogs: true,
                    readReceipts: true,               // Send read receipts after sync
                    statusSync: true,
                    biDirectional: true,
                    welcomeMessage: false,         // Message on topic creation
                    sendOutgoingMessages: false,   // Forward messages from this side
                    presenceUpdates: true,
                    readReceipts: false,
                    animatedStickers: true
                }
            },
            
            // Assistant module configuration
            assistant: {
                enabled: false,                   // Enable AI assistant
                learningMode: true,              // Allow learning new patterns
                suggestionThreshold: 0.6         // Confidence threshold for suggestions
            },

            help: {
                // Default help style:
                // 1 = Box style (╔══ module ══)
                // 2 = Divider style (██▓▒░ module)
                defaultStyle: 1,

                // Default display mode for commands:
                // "description" = show command descriptions
                // "usage" = show usage string
                // "none" = show only command names
                defaultShow: 'description'
            },

            logging: {
                level: 'info',        // Log level: info, warn, error, debug
                saveToFile: true,     // Write logs to file
                maxFileSize: '10MB',  // Max size per log file
                maxFiles: 5           // Max number of rotated files
            },
            
            // Store configuration for enhanced features
            store: {
                useMongoStore: true, // Set to false for file-based store
                filePath: './whatsapp-store.json',
                autoSaveInterval: 30000           // Save every 30 seconds
            },
            
            // Security settings
            security: {
                blockedUsers: [],                 
                maxFileSize: '10MB',  
                maxFiles: 5           
            },

            // Messages configuration
            messages: {
                autoReplyText: 'Hello! This is an automated response. I\'ll get back to you soon.',
                welcomeText: 'Welcome to the group!',
                goodbyeText: 'Goodbye! Thanks for being part of our community.',
                errorText: 'Something went wrong. Please try again later.'
            }
        };

        this.load();
    }

    async load() {
        this.config = { ...this.defaultConfig };
        
        // Initialize MongoDB config if enabled
        if (this.config.auth.useMongoConfig) {
            try {
                this.mongoConfig = new MongoConfig();
                await this.mongoConfig.init();
                this.useMongoConfig = true;
                console.log('✅ MongoDB configuration loaded');
            } catch (error) {
                console.error('❌ Failed to load MongoDB config, falling back to default:', error.message);
                this.useMongoConfig = false;
            }
        } else {
            console.log('✅ Default configuration loaded');
        }
    }

    get(key) {
        if (this.useMongoConfig && this.mongoConfig) {
            const value = this.mongoConfig.get(key);
            if (value !== undefined) {
                return value;
            }
        }
        
        return key.split('.').reduce((o, k) => o && o[k], this.config);
    }

    async set(key, value) {
        if (this.useMongoConfig && this.mongoConfig) {
            await this.mongoConfig.set(key, value);
            return;
        }
        
        const keys = key.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((o, k) => {
            if (typeof o[k] === 'undefined') o[k] = {};
            return o[k];
        }, this.config);
        target[lastKey] = value;
        console.warn(`⚠️ Config key '${key}' was set to '${value}' (in-memory only).`);
    }

    async update(updates) {
        if (this.useMongoConfig && this.mongoConfig) {
            await this.mongoConfig.update(updates);
            return;
        }
        
        this.config = { ...this.config, ...updates };
        console.warn('⚠️ Config was updated in memory. Not persistent.');
    }

    async delete(key) {
        if (this.useMongoConfig && this.mongoConfig) {
            await this.mongoConfig.delete(key);
            return;
        }
        
        const keys = key.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((o, k) => o && o[k], this.config);
        if (target) {
            delete target[lastKey];
        }
    }

    async clear() {
        if (this.useMongoConfig && this.mongoConfig) {
            await this.mongoConfig.clear();
            return;
        }
        
        this.config = { ...this.defaultConfig };
    }

    getAll() {
        if (this.useMongoConfig && this.mongoConfig) {
            return { ...this.defaultConfig, ...this.mongoConfig.getAll() };
        }
        
        return this.config;
    }
}

const configInstance = new Config();

// Export a promise that resolves when config is loaded
module.exports = configInstance;
