// bot.js - HyperWaBot with Custom In-Memory Store

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    getAggregateVotesInPollMessage,
    isJidNewsletter,
    delay,
    proto
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const NodeCache = require('node-cache');

// ✅ Import your custom store
const { makeInMemoryStore } = require('./store'); // or './utils/store'

// Internal modules
const config = require('../config');
const logger = require('./logger');
const MessageHandler = require('./message-handler');
const { connectDb } = require('../utils/db');
const ModuleLoader = require('./module-loader');
const { useMongoAuthState } = require('../utils/mongoAuthState');

// Retry cache
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

        // ✅ Use your custom store
        this.store = makeInMemoryStore({
            logger: logger.child({ module: 'in-memory-store' })
        });

        // ✅ Save store to disk
        const storePath = './auth_info/baileys-store.json';
        if (!fs.existsSync('./auth_info')) {
            fs.mkdirSync('./auth_info', { recursive: true });
        }

        if (fs.existsSync(storePath)) {
            try {
                const saved = fs.readJSONSync(storePath);
                this.store.load(saved);
                logger.info('📁 Message store loaded from disk');
            } catch (err) {
                logger.warn('⚠️ Failed to load store:', err.message);
            }
        }

        // Save every 10 seconds
        setInterval(() => {
            try {
                const state = this.store.save();
                fs.writeJSONSync(storePath, state, { spaces: 2 });
            } catch (err) {
                logger.warn('⚠️ Failed to save store:', err.message);
            }
        }, 10_000);
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot...');

        try {
            this.db = await connectDb();
            logger.info('✅ Database connected successfully!');
        } catch (error) {
            logger.error({ err: error }, '❌ Failed to connect to database');
            process.exit(1);
        }

        if (config.get('telegram.enabled')) {
            try {
                const TelegramBridge = require('../telegram/bridge');
                this.telegramBridge = new TelegramBridge(this);
                await this.telegramBridge.initialize();
                logger.info('✅ Telegram bridge initialized');
                await this.telegramBridge.sendStartMessage();
            } catch (err) {
                logger.warn('⚠️ Telegram bridge failed:', err.message);
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
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        if (this.useMongoAuth) {
            logger.info('🔧 Using MongoDB auth state...');
            try {
                ({ state, saveCreds } = await useMongoAuthState());
            } catch (err) {
                logger.error({ err }, '❌ MongoDB auth failed, falling back...');
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
                // ✅ Pass your custom store
                store: this.store,
            });

            // ✅ Bind store to socket events
            this.store.bind(this.sock.ev);

            this.sock.ev.process(async (events) => {
                if (events['connection.update']) {
                    const { connection, lastDisconnect, qr } = events['connection.update'];

                    if (qr) {
                        logger.info('📱 QR code generated');
                        qrcode.generate(qr, { small: true });
                        if (this.telegramBridge) await this.telegramBridge.sendQRCode(qr);
                    }

                    if (connection === 'close') {
                        if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                            if (!this.isShuttingDown) {
                                logger.warn('🔄 Reconnecting...');
                                this.startSock();
                            }
                        } else {
                            logger.error('❌ Session logged out. Clear auth_info and restart.');
                            process.exit(1);
                        }
                    } else if (connection === 'open') {
                        await this.onConnectionOpen();
                    }
                }

                if (events['creds.update']) await saveCreds();

                // ✅ Handle placeholder messages
                if (events['messages.upsert']) {
                    const upsert = events['messages.upsert'];
                    for (const msg of upsert.messages) {
                        if (msg.messageStubType === 20 && !msg.key.fromMe) {
                            logger.warn(`📩 Placeholder from ${msg.key.remoteJid}, resending...`);
                            await this.sock.readMessages([msg.key]);
                            await this.sock.requestPlaceholderResend(msg.key);
                        }
                    }
                    await this.messageHandler.handleMessages(upsert);
                }
            });

        } catch (err) {
            logger.error({ err }, '❌ Socket init failed');
            setTimeout(() => this.startSock(), 5000);
        }
    }

    // ✅ Use store.loadMessage
    async getMessage(key) {
        if (!key?.remoteJid || !key?.id) return undefined;
        return this.store.loadMessage(key.remoteJid, key.id)?.message || undefined;
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected as ${this.sock.user?.id}`);
        await this.sock.sendPresenceUpdate('available');

        if (!config.get('bot.owner')) {
            config.set('bot.owner', this.sock.user.id);
        }

        if (this.telegramBridge) {
            await this.telegramBridge.setupWhatsAppHandlers();
            await this.telegramBridge.syncWhatsAppConnection();
        }

        await this.sendStartupMessage();
    }

    async sendStartupMessage() {
        const owner = config.get('bot.owner');
        if (!owner) return;
        const msg = `🚀 *HyperWa* is online!\nVersion: ${config.get('bot.version')}`;
        await this.sendMessage(owner, { text: msg });
    }

    async sendMessage(jid, content) {
        if (!this.sock) throw new Error('Socket not ready');
        return await this.sock.sendMessage(jid, content);
    }

    async shutdown() {
        logger.info('🛑 Shutting down...');
        this.isShuttingDown = true;
        if (this.telegramBridge) await this.telegramBridge.shutdown();
        if (this.sock) await this.sock.end();
        logger.info('✅ Shutdown complete');
    }
}

module.exports = { HyperWaBot };
