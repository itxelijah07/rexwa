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
    makeInMemoryStore
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const NodeCache = require('node-cache');

const config = require('../config');
const logger = require('./logger');
const MessageHandler = require('./message-handler');
const { connectDb } = require('../utils/db');
const ModuleLoader = require('./module-loader');
const { useMongoAuthState } = require('../utils/mongoAuthState');

// External retry cache
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
        this.useMongoAuth = config.get('auth.useMongoAuth', false);

        // Use makeInMemoryStore
        this.store = makeInMemoryStore({
            logger: logger.child({ module: 'baileys-store' })
        });

        // 👉 Save store inside auth_info folder
        const storePath = './auth_info/baileys-store.json';

        // Ensure auth_info exists
        if (!fs.existsSync('./auth_info')) {
            fs.mkdirSync('./auth_info', { recursive: true });
        }

        // Load store if exists
        if (fs.existsSync(storePath)) {
            this.store.readFromFile(storePath);
            logger.info('📁 Message store loaded from auth_info');
        }

        // Save every 10 seconds
        setInterval(() => {
            this.store.writeToFile(storePath);
        }, 10_000);
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot...');

        try {
            this.db = await connectDb();
            logger.info('✅ Database connected successfully!');
        } catch (error) {
            logger.error('❌ Failed to connect to database:', error);
            process.exit(1);
        }

        if (config.get('telegram.enabled')) {
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

        await this.moduleLoader.loadModules();
        await this.startSock();

        logger.info('✅ HyperWa Userbot initialized successfully!');
    }

    async startSock() {
        let state, saveCreds;

        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        if (this.useMongoAuth) {
            logger.info('🔧 Using MongoDB auth state...');
            try {
                ({ state, saveCreds } = await useMongoAuthState());
            } catch (error) {
                logger.error('❌ Failed to initialize MongoDB auth state:', error);
                logger.info('🔄 Falling back to file-based auth...');
                ({ state, saveCreds } = await useMultiFileAuthState(this.authPath));
            }
        } else {
            logger.info('🔧 Using file-based auth state...');
            ({ state, saveCreds } = await useMultiFileAuthState(this.authPath));
        }

        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        try {
            this.sock = makeWASocket({
                version,
                logger: logger.child({ module: 'baileys' }),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'signal-keys' })),
                },
                msgRetryCounterCache,
                generateHighQualityLinkPreview: true,
                getMessage: this.getMessage.bind(this),
                browser: ['HyperWa', 'Chrome', '3.0'],
                syncFullHistory: false,
                markOnlineOnConnect: true,
                firewall: false,
                store: this.store,
            });

            this.store.bind(this.sock.ev);

            this.sock.ev.process(async (events) => {
                if (events['connection.update']) {
                    const { connection, lastDisconnect, qr } = events['connection.update'];

                    if (qr) {
                        logger.info('📱 WhatsApp QR code generated');
                        qrcode.generate(qr, { small: true });

                        if (this.telegramBridge) {
                            try {
                                await this.telegramBridge.sendQRCode(qr);
                            } catch (error) {
                                logger.warn('⚠️ TelegramBridge failed to send QR:', error.message);
                            }
                        }
                    }

                    if (connection === 'close') {
                        if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                            if (!this.isShuttingDown) {
                                logger.warn('🔄 Connection closed, reconnecting...');
                                this.startSock();
                            }
                        } else {
                            logger.error('❌ Connection closed permanently. Please delete auth_info and restart.');

                            if (this.useMongoAuth) {
                                try {
                                    const db = await connectDb();
                                    const coll = db.collection("auth");
                                    await coll.deleteOne({ _id: "session" });
                                    logger.info('🗑️ MongoDB auth session cleared');
                                } catch (error) {
                                    logger.error('❌ Failed to clear MongoDB auth session:', error);
                                }
                            }

                            process.exit(1);
                        }
                    } else if (connection === 'open') {
                        await this.onConnectionOpen();
                    }

                    logger.info('Connection update:', events['connection.update']);
                }

                if (events['creds.update']) {
                    try {
                        await saveCreds();
                    } catch (err) {
                        logger.warn('⚠️ Failed to save credentials:', err.message);
                    }
                }

                if (events['stream-resumed']) {
                    logger.info('📶 Connection resumed. Syncing...');
                    await this.sock.sendPresenceUpdate('available');
                }

                if (events['messages.upsert']) {
                    const upsert = events['messages.upsert'];
                    logger.debug('📨 Received messages:', JSON.stringify(upsert, null, 2));

                    for (const msg of upsert.messages) {
                        if (msg.messageStubType === 20 && !msg.key.fromMe) {
                            logger.warn(`📩 Placeholder from ${msg.key.remoteJid}, requesting resend...`);
                            try {
                                await this.sock.readMessages([msg.key]);
                                const reqId = await this.sock.requestPlaceholderResend(msg.key);
                                logger.info(`🔄 Resend requested: ${reqId}`);
                            } catch (err) {
                                logger.warn('Failed to request resend:', err.message);
                            }
                        }
                    }

                    try {
                        await this.messageHandler.handleMessages(upsert);
                    } catch (err) {
                        logger.warn('⚠️ Handler error:', err.message);
                    }
                }

                if (events['messages.update']) {
                    for (const { key, update } of events['messages.update']) {
                        if (update.pollUpdates) {
                            const msg = await this.store.loadMessage(key.remoteJid, key.id);
                            if (msg) {
                                logger.info('📊 Poll update:', getAggregateVotesInPollMessage({
                                    message: msg,
                                    pollUpdates: update.pollUpdates,
                                }));
                            }
                        }
                    }
                }

                if (events['chats.update']) {
                    logger.debug('💬 Chats updated:', events['chats.update']);
                }

                if (events['contacts.update']) {
                    for (const contact of events['contacts.update']) {
                        if (typeof contact.imgUrl !== 'undefined') {
                            const url = contact.imgUrl
                                ? await this.sock.profilePictureUrl(contact.id).catch(() => null)
                                : null;
                            logger.info(`📸 ${contact.id} profile pic: ${url}`);
                        }
                    }
                }

                if (events.call) {
                    logger.info('📞 Call received:', events.call);
                    for (const { from, id } of events.call) {
                        try {
                            await this.sock.rejectCall(id, from);
                        } catch (err) {
                            logger.warn('Failed to reject call:', err.message);
                        }
                    }
                }
            });

        } catch (error) {
            logger.error('❌ Socket init failed:', error);
            setTimeout(() => this.startSock(), 5000);
        }
    }

    async getMessage(key) {
        if (!key?.remoteJid || !key?.id) return undefined;
        try {
            const msg = await this.store.loadMessage(key.remoteJid, key.id);
            return msg?.message || undefined;
        } catch (err) {
            logger.warn('⚠️ getMessage error:', err.message);
            return undefined;
        }
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected to WhatsApp! User: ${this.sock.user?.id || 'Unknown'}`);

        const { jid } = this.sock.user;
        await this.sock.presenceSubscribe(jid);
        await delay(500);
        await this.sock.sendPresenceUpdate('available');
        await delay(1000);

        logger.info('🔄 Fetching top chats to sync...');
        await this.sock.fetchTopChats();

        if (!config.get('bot.owner')) {
            config.set('bot.owner', this.sock.user.id);
            logger.info(`👑 Owner set to: ${this.sock.user.id}`);
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.setupWhatsAppHandlers();
                await this.telegramBridge.syncWhatsAppConnection();
            } catch (err) {
                logger.warn('⚠️ Telegram setup failed:', err.message);
            }
        }

        await this.sendStartupMessage();
    }

    async sendStartupMessage() {
        const owner = config.get('bot.owner');
        if (!owner) return;

        const startupMsg = `🚀 *${config.get('bot.name')} v${config.get('bot.version')}* is online!\n\n` +
            `• 🤖 Telegram Bridge: ${config.get('telegram.enabled') ? '✅' : '❌'}\n` +
            `Type *${config.get('bot.prefix')}help* for commands.`;

        try {
            await this.sendMessage(owner, { text: startupMsg });
        } catch (err) {
            logger.warn('Failed to send startup message:', err.message);
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.logToTelegram('🚀 Bot Started', startupMsg);
            } catch (err) {
                logger.warn('Telegram log failed:', err.message);
            }
        }
    }

    async connect() {
        if (!this.sock) await this.startSock();
        return this.sock;
    }

    async sendMessage(jid, content) {
        if (!this.sock) throw new Error('Socket not initialized');
        return await this.sock.sendMessage(jid, content);
    }

    async shutdown() {
        logger.info('🛑 Shutting down...');
        this.isShuttingDown = true;

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.shutdown();
            } catch (err) {
                logger.warn('Telegram shutdown error:', err.message);
            }
        }

        if (this.sock) {
            await this.sock.end();
        }

        logger.info('✅ Shutdown complete');
    }
}

module.exports = { HyperWaBot };
