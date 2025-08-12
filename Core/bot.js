const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, getAggregateVotesInPollMessage, isJidNewsletter, delay, proto, encodeWAM, BinaryInfo } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const NodeCache = require('node-cache');
const readline = require('readline');

const config = require('../config');
const logger = require('./logger');
const MessageHandler = require('./message-handler');
const { connectDb } = require('../utils/db');
const ModuleLoader = require('./module-loader');
const { useMongoAuthState } = require('../utils/mongoAuthState');

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
        this.usePairingCode = process.argv.includes('--use-pairing-code');
        this.doReplies = process.argv.includes('--do-reply');
        
        // External map to store retry counts of messages when decryption/encryption fails
        // Keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
        this.msgRetryCounterCache = new NodeCache({
            stdTTL: 300,
            maxKeys: 500
        });
        
        // On-demand map for message history
        this.onDemandMap = new Map();
        
        // Simple memory cleanup
        setInterval(() => {
            if (this.onDemandMap.size > 100) {
                this.onDemandMap.clear();
            }
        }, 300000);

        // Read line interface for pairing code
        this.rl = readline.createInterface({ 
            input: process.stdin, 
            output: process.stdout 
        });
    }

    question(text) {
        return new Promise((resolve) => this.rl.question(text, resolve));
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

        // Clean up existing socket if present
        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        // Choose auth method based on configuration
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

        // Fetch latest version of WA Web
        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        try {
            this.sock = makeWASocket({
                version,
                logger: logger.child({ module: 'baileys' }),
                auth: {
                    creds: state.creds,
                    /** caching makes the store faster to send/recv messages */
                    keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'signal-keys' })),
                },
                msgRetryCounterCache: this.msgRetryCounterCache,
                generateHighQualityLinkPreview: true,
                // ignore all broadcast messages -- to receive the same
                // comment the line below out
                // shouldIgnoreJid: jid => isJidBroadcast(jid),
                // implement to handle retries & poll updates
                getMessage: this.getMessage.bind(this),
                browser: ['HyperWa', 'Chrome', '3.0'],
                // Enable message history for better message retrieval
                syncFullHistory: false,
                markOnlineOnConnect: true,
                // Add firewall bypass
                firewall: false
            });

            // Pairing code for Web clients
            if (this.usePairingCode && !this.sock.authState.creds.registered) {
                const phoneNumber = await this.question('Please enter your phone number:\n');
                const code = await this.sock.requestPairingCode(phoneNumber);
                logger.info(`Pairing code: ${code}`);
            }

            // The process function lets you process all events that just occurred efficiently in a batch
            this.sock.ev.process(async (events) => {
                try {
                    // Something about the connection changed
                    if (events['connection.update']) {
                        await this.handleConnectionUpdate(events['connection.update']);
                    }

                    // Credentials updated -- save them
                    if (events['creds.update']) {
                        await saveCreds();
                    }

                    if (events['labels.association']) {
                        logger.info('📋 Label association update:', events['labels.association']);
                    }

                    if (events['labels.edit']) {
                        logger.info('📝 Label edit update:', events['labels.edit']);
                    }

                    if (events.call) {
                        logger.info('📞 Call event received:', events.call);
                    }

                    // History received
                    if (events['messaging-history.set']) {
                        const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set'];
                        if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
                            logger.info('📥 Received on-demand history sync, messages:', messages.length);
                        }
                        logger.info(`📊 History sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (latest: ${isLatest}, progress: ${progress}%)`);
                    }

                    // Received a new message
                    if (events['messages.upsert']) {
                        await this.handleMessagesUpsert(events['messages.upsert']);
                    }

                    // Messages updated like status delivered, message deleted etc.
                    if (events['messages.update']) {
                        logger.debug('Messages update:', JSON.stringify(events['messages.update'], undefined, 2));

                        for (const { key, update } of events['messages.update']) {
                            if (update.pollUpdates) {
                                const pollCreation = {}; // get the poll creation message somehow
                                if (pollCreation) {
                                    logger.info('📊 Poll update received, aggregation:', 
                                        getAggregateVotesInPollMessage({
                                            message: pollCreation,
                                            pollUpdates: update.pollUpdates,
                                        })
                                    );
                                }
                            }
                        }
                    }

                    if (events['message-receipt.update']) {
                        logger.debug('📨 Message receipt update:', events['message-receipt.update']);
                    }

                    if (events['messages.reaction']) {
                        logger.info('😀 Message reactions:', events['messages.reaction']);
                    }

                    if (events['presence.update']) {
                        logger.debug('👤 Presence update:', events['presence.update']);
                    }

                    if (events['chats.update']) {
                        logger.debug('💬 Chats updated:', events['chats.update']);
                    }

                    if (events['contacts.update']) {
                        for (const contact of events['contacts.update']) {
                            if (typeof contact.imgUrl !== 'undefined') {
                                const newUrl = contact.imgUrl === null
                                    ? null
                                    : await this.sock.profilePictureUrl(contact.id).catch(() => null);
                                logger.info(`👤 Contact ${contact.id} has a new profile pic: ${newUrl}`);
                            }
                        }
                    }

                    if (events['chats.delete']) {
                        logger.info('🗑️ Chats deleted:', events['chats.delete']);
                    }

                } catch (error) {
                    logger.warn('⚠️ Event processing error:', error.message);
                }
            });

        } catch (error) {
            logger.error('❌ Failed to initialize WhatsApp socket:', error);
            logger.info('🔄 Retrying with new QR code...');
            setTimeout(() => this.startSock(), 5000);
        }
    }

    async handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

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
            // Reconnect if not logged out
            if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                if (!this.isShuttingDown) {
                    logger.warn('🔄 Connection closed, reconnecting...');
                    setTimeout(() => this.startSock(), 5000);
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

        logger.info('Connection update:', update);
    }

    async handleMessagesUpsert(upsert) {
        logger.debug('Received messages:', JSON.stringify(upsert, undefined, 2));

        if (!!upsert.requestId) {
            logger.info("📥 Placeholder message received for request of id=" + upsert.requestId, upsert);
        }

        if (upsert.type === 'notify') {
            for (const msg of upsert.messages) {
                try {
                    await this.processIncomingMessage(msg, upsert);
                } catch (error) {
                    logger.warn('⚠️ Message processing error:', error.message);
                }
            }
        }

        try {
            await this.messageHandler.handleMessages({ messages: upsert.messages, type: upsert.type });
        } catch (error) {
            logger.warn('⚠️ Original message handler error:', error.message);
        }
    }

    async processIncomingMessage(msg, upsert) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        
        if (text) {
            // Handle special commands
            if (text === "requestPlaceholder" && !upsert.requestId) {
                const messageId = await this.sock.requestPlaceholderResend(msg.key);
                logger.info('🔄 Requested placeholder resync, ID:', messageId);
                return;
            }

            // Go to an old chat and send this
            if (text === "onDemandHistSync") {
                const messageId = await this.sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
                logger.info('📥 Requested on-demand sync, ID:', messageId);
                return;
            }

            // Auto-reply functionality (if enabled)
            if (!msg.key.fromMe && this.doReplies && !isJidNewsletter(msg.key?.remoteJid)) {
                logger.info('🤖 Auto-replying to:', msg.key.remoteJid);
                await this.sock.readMessages([msg.key]);
                await this.sendMessageWTyping({ text: 'Hello there!' }, msg.key.remoteJid);
            }
        }
    }

    async sendMessageWTyping(msg, jid) {
        try {
            await this.sock.presenceSubscribe(jid);
            await delay(500);

            await this.sock.sendPresenceUpdate('composing', jid);
            await delay(2000);

            await this.sock.sendPresenceUpdate('paused', jid);

            await this.sock.sendMessage(jid, msg);
        } catch (error) {
            logger.debug('Typing indicator failed (non-critical):', error.message);
            // Still try to send the message
            await this.sock.sendMessage(jid, msg);
        }
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected to WhatsApp! User: ${this.sock.user?.id || 'Unknown'}`);

        if (!config.get('bot.owner') && this.sock.user) {
            config.set('bot.owner', this.sock.user.id);
            logger.info(`👑 Owner set to: ${this.sock.user.id}`);
        }

        // WARNING: THIS WILL SEND A WAM EXAMPLE AND THIS IS A ****CAPTURED MESSAGE.****
        // DO NOT ACTUALLY ENABLE THIS UNLESS YOU MODIFIED THE FILE.JSON!!!!!
        const sendWAMExample = false;
        if (sendWAMExample) {
            try {
                const wamData = JSON.parse(await fs.readFile("./boot_analytics_test.json", "utf-8"));
                const {
                    header: {
                        wamVersion,
                        eventSequenceNumber,
                    },
                    events,
                } = wamData;

                const binaryInfo = new BinaryInfo({
                    protocolVersion: wamVersion,
                    sequence: eventSequenceNumber,
                    events: events
                });

                const buffer = encodeWAM(binaryInfo);
                const result = await this.sock.sendWAMBuffer(buffer);
                logger.info('WAM buffer sent:', result);
            } catch (error) {
                logger.warn('WAM example failed:', error.message);
            }
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.setupWhatsAppHandlers();
            } catch (err) {
                logger.warn('⚠️ Failed to setup Telegram WhatsApp handlers:', err.message);
            }
        }

        await this.sendStartupMessage();

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.syncWhatsAppConnection();
            } catch (err) {
                logger.warn('⚠️ Telegram sync error:', err.message);
            }
        }
    }

    async sendStartupMessage() {
        const owner = config.get('bot.owner');
        if (!owner) return;

        const authMethod = this.useMongoAuth ? 'MongoDB' : 'File-based';
        
        const startupMessage = `🚀 *${config.get('bot.name')} v${config.get('bot.version')}* is now online!\n\n` +
                              `🔥 *HyperWa Features Active:*\n` +
                              `• 📱 Modular Architecture\n` +
                              `• 🗄️ Default Baileys Store: ✅\n` +
                              `• 🔐 Auth Method: ${authMethod}\n` +
                              `• 🤖 Telegram Bridge: ${config.get('telegram.enabled') ? '✅' : '❌'}\n` +
                              `• 🔧 Custom Modules: ${config.get('features.customModules') ? '✅' : '❌'}\n` +
                              `• 🔄 Auto Replies: ${this.doReplies ? '✅' : '❌'}\n` +
                              `• 📱 Pairing Code: ${this.usePairingCode ? '✅' : '❌'}\n` +
                              `Type *${config.get('bot.prefix')}help* for available commands!`;

        try {
            await this.sendMessage(owner, { text: startupMessage });
        } catch {}

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.logToTelegram('🚀 HyperWa Bot Started', startupMessage);
            } catch (err) {
                logger.warn('⚠️ Telegram log failed:', err.message);
            }
        }
    }

    // Implement a way to retrieve messages that were upserted from messages.upsert
    async getMessage(key) {
        try {
            // You can implement your own message retrieval logic here
            // For now, return a simple test message as in the example
            return proto.Message.fromObject({ conversation: 'test' });
        } catch (error) {
            logger.warn('⚠️ Error retrieving message:', error.message);
            return undefined;
        }
    }

    async connect() {
        if (!this.sock) {
            await this.startSock();
        }
        return this.sock;
    }

    async sendMessage(jid, content) {
        if (!this.sock) {
            throw new Error('WhatsApp socket not initialized');
        }
        
        return await this.sock.sendMessage(jid, content);
    }

    async shutdown() {
        logger.info('🛑 Shutting down HyperWa Userbot...');
        this.isShuttingDown = true;

        if (this.rl) {
            this.rl.close();
        }

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
