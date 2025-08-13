const { connectDb } = require('./db');
const logger = require('../Core/logger');
const events = require('events');

class MongoStore extends events.EventEmitter {
    constructor(options = {}) {
        super();
        
        this.db = null;
        this.collections = {};
        this.cache = {
            contacts: new Map(),
            chats: new Map(),
            messages: new Map(),
            presences: new Map(),
            groupMetadata: new Map()
        };
        
        this.options = {
            cacheSize: options.cacheSize || 1000,
            autoSave: options.autoSave !== false,
            saveInterval: options.saveInterval || 30000
        };
        
        this.initialized = false;
        this.saveTimer = null;
    }

    async init() {
        if (this.initialized) return;
        
        try {
            this.db = await connectDb();
            
            // Initialize collections
            this.collections = {
                contacts: this.db.collection('wa_contacts'),
                chats: this.db.collection('wa_chats'),
                messages: this.db.collection('wa_messages'),
                presences: this.db.collection('wa_presences'),
                groupMetadata: this.db.collection('wa_group_metadata')
            };
            
            // Create indexes for better performance
            await this.createIndexes();
            
            // Load data into cache
            await this.loadFromDatabase();
            
            // Start auto-save if enabled
            if (this.options.autoSave) {
                this.startAutoSave();
            }
            
            this.initialized = true;
            logger.info('✅ MongoDB store initialized');
        } catch (error) {
            logger.error('❌ Failed to initialize MongoDB store:', error);
            throw error;
        }
    }

    async createIndexes() {
        try {
            await Promise.all([
                this.collections.contacts.createIndex({ id: 1 }, { unique: true }),
                this.collections.chats.createIndex({ id: 1 }, { unique: true }),
                this.collections.messages.createIndex({ 'key.remoteJid': 1, 'key.id': 1 }, { unique: true }),
                this.collections.messages.createIndex({ 'key.remoteJid': 1, messageTimestamp: -1 }),
                this.collections.presences.createIndex({ chatId: 1, participant: 1 }),
                this.collections.groupMetadata.createIndex({ id: 1 }, { unique: true })
            ]);
            logger.debug('📊 MongoDB store indexes created');
        } catch (error) {
            logger.error('❌ Failed to create indexes:', error);
        }
    }

    async loadFromDatabase() {
        try {
            // Load contacts
            const contacts = await this.collections.contacts.find({}).toArray();
            for (const contact of contacts) {
                this.cache.contacts.set(contact.id, contact);
            }

            // Load chats
            const chats = await this.collections.chats.find({}).toArray();
            for (const chat of chats) {
                this.cache.chats.set(chat.id, chat);
            }

            // Load recent messages (last 1000 per chat)
            const recentMessages = await this.collections.messages
                .find({})
                .sort({ messageTimestamp: -1 })
                .limit(10000)
                .toArray();
            
            for (const msg of recentMessages) {
                const chatId = msg.key.remoteJid;
                if (!this.cache.messages.has(chatId)) {
                    this.cache.messages.set(chatId, new Map());
                }
                this.cache.messages.get(chatId).set(msg.key.id, msg);
            }

            // Load group metadata
            const groups = await this.collections.groupMetadata.find({}).toArray();
            for (const group of groups) {
                this.cache.groupMetadata.set(group.id, group);
            }

            logger.info(`📥 Loaded from MongoDB - Contacts: ${contacts.length}, Chats: ${chats.length}, Messages: ${recentMessages.length}, Groups: ${groups.length}`);
        } catch (error) {
            logger.error('❌ Failed to load from database:', error);
        }
    }

    startAutoSave() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }
        
        this.saveTimer = setInterval(() => {
            this.saveToDatabase().catch(error => {
                logger.error('❌ Auto-save failed:', error);
            });
        }, this.options.saveInterval);
    }

    async saveToDatabase() {
        if (!this.initialized) return;
        
        try {
            const operations = [];

            // Save contacts
            for (const [id, contact] of this.cache.contacts) {
                operations.push({
                    updateOne: {
                        filter: { id },
                        update: { $set: { ...contact, updatedAt: new Date() } },
                        upsert: true
                    }
                });
            }
            if (operations.length > 0) {
                await this.collections.contacts.bulkWrite(operations);
                operations.length = 0;
            }

            // Save chats
            for (const [id, chat] of this.cache.chats) {
                operations.push({
                    updateOne: {
                        filter: { id },
                        update: { $set: { ...chat, updatedAt: new Date() } },
                        upsert: true
                    }
                });
            }
            if (operations.length > 0) {
                await this.collections.chats.bulkWrite(operations);
                operations.length = 0;
            }

            // Save messages (only recent ones to avoid huge collections)
            for (const [chatId, messages] of this.cache.messages) {
                const recentMessages = Array.from(messages.values())
                    .sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))
                    .slice(0, 100); // Keep only last 100 messages per chat

                for (const msg of recentMessages) {
                    operations.push({
                        updateOne: {
                            filter: { 'key.remoteJid': msg.key.remoteJid, 'key.id': msg.key.id },
                            update: { $set: { ...msg, updatedAt: new Date() } },
                            upsert: true
                        }
                    });
                }
            }
            if (operations.length > 0) {
                await this.collections.messages.bulkWrite(operations);
                operations.length = 0;
            }

            // Save group metadata
            for (const [id, group] of this.cache.groupMetadata) {
                operations.push({
                    updateOne: {
                        filter: { id },
                        update: { $set: { ...group, updatedAt: new Date() } },
                        upsert: true
                    }
                });
            }
            if (operations.length > 0) {
                await this.collections.groupMetadata.bulkWrite(operations);
            }

            logger.debug('💾 Store data saved to MongoDB');
        } catch (error) {
            logger.error('❌ Failed to save to database:', error);
        }
    }

    // Contact methods
    upsertContact(contact) {
        if (!contact.id) return;
        this.cache.contacts.set(contact.id, { ...this.cache.contacts.get(contact.id), ...contact });
        this.emit('contacts.upsert', [contact]);
    }

    getContact(id) {
        return this.cache.contacts.get(id);
    }

    // Chat methods
    upsertChat(chat) {
        if (!chat.id) return;
        this.cache.chats.set(chat.id, { ...this.cache.chats.get(chat.id), ...chat });
        this.emit('chats.upsert', [chat]);
    }

    getChat(id) {
        return this.cache.chats.get(id);
    }

    // Message methods
    upsertMessage(message, type = 'append') {
        try {
            const chatId = message?.key?.remoteJid;
            const msgId = message?.key?.id;
            
            if (!chatId || !msgId) return;

            if (!this.cache.messages.has(chatId)) {
                this.cache.messages.set(chatId, new Map());
            }

            const chatMessages = this.cache.messages.get(chatId);
            chatMessages.set(msgId, JSON.parse(JSON.stringify(message)));

            // Limit cache size per chat
            if (chatMessages.size > this.options.cacheSize) {
                const entries = Array.from(chatMessages.entries());
                const toKeep = entries
                    .sort((a, b) => (b[1].messageTimestamp || 0) - (a[1].messageTimestamp || 0))
                    .slice(0, Math.floor(this.options.cacheSize * 0.8));
                
                chatMessages.clear();
                toKeep.forEach(([id, msg]) => chatMessages.set(id, msg));
            }

            this.emit('messages.upsert', { messages: [message], type });
        } catch (error) {
            logger.error('❌ Error upserting message:', error);
        }
    }

    loadMessage(jid, id) {
        try {
            const chatMessages = this.cache.messages.get(jid);
            if (chatMessages && chatMessages.has(id)) {
                return JSON.parse(JSON.stringify(chatMessages.get(id)));
            }
            return undefined;
        } catch (error) {
            logger.error('❌ Error loading message:', error);
            return undefined;
        }
    }

    getMessages(jid, limit = 50) {
        const chatMessages = this.cache.messages.get(jid);
        if (!chatMessages) return [];
        
        return Array.from(chatMessages.values())
            .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
            .slice(-limit);
    }

    // Group metadata methods
    setGroupMetadata(groupId, metadata) {
        if (!groupId) return;
        this.cache.groupMetadata.set(groupId, metadata);
        this.emit('groups.update', [{ id: groupId, ...metadata }]);
    }

    getGroupMetadata(groupId) {
        return this.cache.groupMetadata.get(groupId);
    }

    // Bind to external event emitter
    bind(ev) {
        if (!ev?.on) throw new Error('Event emitter is required for binding');
        
        const safeHandler = (handler) => {
            return (...args) => {
                try {
                    handler(...args);
                } catch (error) {
                    logger.error('Store event handler error:', error);
                }
            };
        };

        ev.on('contacts.upsert', safeHandler((contacts) => 
            Array.isArray(contacts) && contacts.forEach(this.upsertContact.bind(this))));
        
        ev.on('chats.upsert', safeHandler((chats) => 
            Array.isArray(chats) && chats.forEach(this.upsertChat.bind(this))));
        
        ev.on('messages.upsert', safeHandler(({ messages, type }) => 
            Array.isArray(messages) && messages.forEach(msg => this.upsertMessage(msg, type))));
        
        ev.on('groups.update', safeHandler((groups) => 
            Array.isArray(groups) && groups.forEach(group => this.setGroupMetadata(group.id, group))));

        logger.info('📡 Store events bound successfully');
    }

    // Cleanup method
    async cleanup() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        
        await this.saveToDatabase();
        
        // Clear cache
        this.cache.contacts.clear();
        this.cache.chats.clear();
        this.cache.messages.clear();
        this.cache.presences.clear();
        this.cache.groupMetadata.clear();
        
        logger.info('🧹 MongoDB store cleanup completed');
    }

    // Statistics
    getStats() {
        return {
            contacts: this.cache.contacts.size,
            chats: this.cache.chats.size,
            messages: Array.from(this.cache.messages.values()).reduce((total, chatMsgs) => total + chatMsgs.size, 0),
            groups: this.cache.groupMetadata.size
        };
    }
}

// Factory function
function makeMongoStore(options = {}) {
    return new MongoStore(options);
}

module.exports = { makeMongoStore, MongoStore };