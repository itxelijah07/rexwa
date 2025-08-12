const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    getAggregateVotesInPollMessage,
    isJidNewsletter,
    delay,
    proto,
    makeInMemoryStore // ✅ Added
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const NodeCache = require('node-cache');
const config = require('../config');
const logger = require('./logger');
const MessageHandler = require('./message-handler');
const { connectDb } = require('../utils/db');
const ModuleLoader = require('./module-loader');
const { useMongoAuthState } = require('../utils/mongoAuthState');

const msgRetryCounterCache = new NodeCache();

class HyperWaBot {
    constructor() {
        this.sock = null;
        this.authPath = './auth_info';
        this.messageHandler = new MessageHandler(this);
        this.telegramBridge = null;
        this.isShuttingDown = false;
        this.db = null;
        this.moduleLoader = new ModuleLoader(this);
        this.qrCodeSent = false;
        this.useMongoAuth = config.get('auth.useMongoAuth', false);

        // ✅ Proper Baileys in-memory store
        this.store = makeInMemoryStore({ logger: logger.child({ module: 'store' }) });

        // Legacy custom message store as backup
        this.messageStore = new Map();
        setInterval(() => {
            if (this.messageStore.size > 1000) {
                const entries = Array.from(this.messageStore.entries());
                const toKeep = entries.slice(-500);
                this.messageStore.clear();
                toKeep.forEach(([key, value]) => this.messageStore.set(key, value));
                logger.debug('🧹 Message store cleaned up');
            }
        }, 300000);
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot...');
        try {
            this.db = await connectDb();
            logger.info('✅ Database connected successfully!');

            if (config.get('telegram.enabled')) {
                await this.initializeTelegramBridge();
            }

            await this.moduleLoader.loadModules();
            await this.startSock();

            logger.info('✅ HyperWa Userbot initialized successfully!');
        } catch (error) {
            logger.error('❌ Initialization failed:', error);
            process.exit(1);
        }
    }

    async initializeTelegramBridge() {
        try {
            const TelegramBridge = require('../telegram/bridge');
            this.telegramBridge = new TelegramBridge(this);
            await this.telegramBridge.initialize();
            logger.info('✅ Telegram bridge initialized');

            try {
                await this.telegramBridge.sendStartMessage();
            } catch (err) {
                logger.warn('⚠️ Failed to send start message via Telegram:', err.message);
            }
        } catch (error) {
            logger.warn('⚠️ Telegram bridge failed to initialize:', error.message);
            this.telegramBridge = null;
        }
    }

    async startSock() {
        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        let state, saveCreds;
        try {
            if (this.useMongoAuth) {
                ({ state, saveCreds } = await this.initializeMongoAuth());
            } else {
                ({ state, saveCreds } = await useMultiFileAuthState(this.authPath));
            }

            const { version } = await fetchLatestBaileysVersion();
            logger.info(`📱 Using WA v${version.join('.')}`);

            this.sock = makeWASocket({
                version,
                logger: logger.child({ module: 'baileys' }),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'signal-keys' }))
                },
                msgRetryCounterCache,
                generateHighQualityLinkPreview: true,
                getMessage: this.getEnhancedMessage.bind(this),
                browser: ['HyperWa', 'Chrome', '3.0'],
                syncFullHistory: false,
                markOnlineOnConnect: false,
                shouldIgnoreJid: jid => isJidNewsletter(jid),
                fireInitQueries: false
            });

            // ✅ Bind store to socket events
            this.store.bind(this.sock.ev);

            this.setupEventHandlers(saveCreds);
        } catch (error) {
            logger.error('❌ Failed to initialize WhatsApp socket:', error);
            setTimeout(() => this.startSock(), 5000);
        }
    }

    async initializeMongoAuth() {
        try {
            logger.info('🔧 Using MongoDB auth state...');
            return await useMongoAuthState();
        } catch (error) {
            logger.error('❌ Failed to initialize MongoDB auth state:', error);
            logger.info('🔄 Falling back to file-based auth...');
            return await useMultiFileAuthState(this.authPath);
        }
    }

    setupEventHandlers(saveCreds) {
        this.sock.ev.process(async (events) => {
            if (events['connection.update']) await this.handleConnectionUpdate(events['connection.update']);
            if (events['creds.update']) await saveCreds();
            if (events['messages.upsert']) await this.handleMessagesUpsert(events['messages.upsert']);
            if (events['messages.update']) await this.handleMessagesUpdate(events['messages.update']);
        });
    }

    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info('📱 WhatsApp QR code generated');
            qrcode.generate(qr, { small: true });
            await this.handleQRCode(qr);
        }

        if (connection === 'close') {
            await this.handleConnectionClose(lastDisconnect);
        } else if (connection === 'open') {
            await this.onConnectionOpen();
        }
    }

    async handleQRCode(qr) {
        if (this.telegramBridge) {
            try {
                await this.telegramBridge.sendQRCode(qr);
            } catch (error) {
                logger.warn('⚠️ TelegramBridge failed to send QR:', error.message);
            }
        }
    }

    async handleConnectionClose(lastDisconnect) {
        if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
            if (!this.isShuttingDown) {
                logger.warn('🔄 Connection closed, reconnecting...');
                this.startSock();
            }
        } else {
            await this.handlePermanentConnectionClose();
        }
    }

    async handlePermanentConnectionClose() {
        logger.error('❌ Connection closed permanently. Please delete auth_info and restart.');
        if (this.useMongoAuth) {
            try {
                const coll = this.db.collection("auth");
                await coll.deleteOne({ _id: "session" });
                logger.info('🗑️ MongoDB auth session cleared');
            } catch (error) {
                logger.error('❌ Failed to clear MongoDB auth session:', error);
            }
        }
        process.exit(1);
    }

    async handleMessagesUpsert(upsert) {
        try {
            for (const msg of upsert.messages) {
                if (msg.key?.id && msg.message) {
                    this.messageStore.set(msg.key.id, msg.message);

                    if (this.db) {
                        await this.db.collection("messages").updateOne(
                            { id: msg.key.id },
                            { $set: { ...msg, timestamp: new Date() } },
                            { upsert: true }
                        ).catch(e => logger.error('DB store failed:', e));
                    }
                }
            }

            if (upsert.type === 'notify') {
                await this.processNewMessages(upsert.messages);
            }
        } catch (error) {
            logger.error('Message upsert handling failed:', error);
        }
    }

    async processNewMessages(messages) {
        for (const msg of messages) {
            try {
                await this.messageHandler.handleMessages({
                    messages: [msg],
                    type: 'notify'
                });
            } catch (error) {
                logger.error('Message processing failed:', error);
            }
        }
    }

    async handleMessagesUpdate(updates) {
        for (const { key, update } of updates) {
            try {
                if (update.pollUpdates) {
                    const pollCreation = await this.getEnhancedMessage(key);
                    if (pollCreation) {
                        logger.info('📊 Poll update received, aggregation:',
                            getAggregateVotesInPollMessage({
                                message: { message: pollCreation },
                                pollUpdates: update.pollUpdates,
                            })
                        );
                    }
                }
            } catch (error) {
                logger.error('Message update handling failed:', error);
            }
        }
    }

    async getEnhancedMessage(key) {
        try {
            if (key.id) {
                // ✅ First check Baileys in-memory store
                const storeMsg = this.store.loadMessage(key.remoteJid, key.id);
                if (storeMsg) return storeMsg.message;

                // Check our legacy store
                if (this.messageStore.has(key.id)) {
                    return this.messageStore.get(key.id);
                }

                // Check database
                if (this.db) {
                    const msg = await this.db.collection("messages").findOne({ id: key.id });
                    if (msg) return msg.message;
                }
            }
            return proto.Message.fromObject({
                conversation: "[Message unavailable]",
                messageContextInfo: { deviceListMetadataVersion: 2 }
            });
        } catch (error) {
            logger.error('getMessage error:', error);
            return proto.Message.fromObject({ conversation: "[Error loading message]" });
        }
    }

    async shutdown() {
        logger.info('🛑 Shutting down HyperWa Userbot...');
        this.isShuttingDown = true;
        this.messageStore.clear();

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.shutdown();
            } catch (err) {
                logger.warn('⚠️ Telegram shutdown error:', err.message);
            }
        }

        if (this.sock) {
            await this.sock.end();
        }

        logger.info('✅ HyperWa Userbot shutdown complete');
    }
}

module.exports = { HyperWaBot };
