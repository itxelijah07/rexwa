const config = require('../config');
const logger = require('../Core/logger');
const { delay } = require('@whiskeysockets/baileys');

class PresenceModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'presence';
        this.metadata = {
            description: 'Manages presence updates, typing indicators, and read receipts',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'system'
        };

        // Configuration
        this.enableTypingIndicators = config.get('features.typingIndicators', true);
        this.autoReadMessages = config.get('features.autoReadMessages', true);
        this.presenceUpdates = config.get('features.presenceUpdates', true);

        this.commands = [
            {
                name: 'typing',
                description: 'Toggle typing indicators',
                usage: '.typing on/off',
                permissions: 'owner',
                execute: this.toggleTyping.bind(this)
            },
            {
                name: 'autoread',
                description: 'Toggle auto read messages',
                usage: '.autoread on/off',
                permissions: 'owner',
                execute: this.toggleAutoRead.bind(this)
            },
            {
                name: 'presence',
                description: 'Toggle presence updates',
                usage: '.presence on/off',
                permissions: 'owner',
                execute: this.togglePresence.bind(this)
            }
        ];

        // Message hooks for presence management
        this.messageHooks = {
            'pre_process': this.handlePresenceForMessage.bind(this),
            'post_process': this.handlePostMessagePresence.bind(this)
        };
    }

    async toggleTyping(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `⌨️ *Typing Indicators*\n\nCurrent: ${this.enableTypingIndicators ? 'ON' : 'OFF'}\n\nUsage: .typing on/off`;
        }

        this.enableTypingIndicators = action === 'on';
        config.set('features.typingIndicators', this.enableTypingIndicators);
        
        return `⌨️ Typing indicators ${this.enableTypingIndicators ? 'enabled' : 'disabled'}`;
    }

    async toggleAutoRead(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `📖 *Auto Read Messages*\n\nCurrent: ${this.autoReadMessages ? 'ON' : 'OFF'}\n\nUsage: .autoread on/off`;
        }

        this.autoReadMessages = action === 'on';
        config.set('features.autoReadMessages', this.autoReadMessages);
        
        return `📖 Auto read messages ${this.autoReadMessages ? 'enabled' : 'disabled'}`;
    }

    async togglePresence(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `👤 *Presence Updates*\n\nCurrent: ${this.presenceUpdates ? 'ON' : 'OFF'}\n\nUsage: .presence on/off`;
        }

        this.presenceUpdates = action === 'on';
        config.set('features.presenceUpdates', this.presenceUpdates);
        
        return `👤 Presence updates ${this.presenceUpdates ? 'enabled' : 'disabled'}`;
    }

    async handlePresenceForMessage(msg, text, bot) {
        // Skip own messages
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;

        try {
            // Subscribe to presence updates
            if (this.presenceUpdates && bot.sock) {
                await bot.sock.presenceSubscribe(sender);
            }

            // Auto read messages
            if (this.autoReadMessages && bot.sock) {
                await bot.sock.readMessages([msg.key]);
            }
        } catch (error) {
            logger.debug('Presence handling failed (non-critical):', error.message);
        }
    }

    async handlePostMessagePresence(msg, text, bot) {
        // Update presence to available after processing
        if (this.presenceUpdates && bot.sock && !msg.key.fromMe) {
            try {
                await bot.sock.sendPresenceUpdate('available', msg.key.remoteJid);
            } catch (error) {
                logger.debug('Post-message presence update failed (non-critical):', error.message);
            }
        }
    }

    async sendMessageWithTyping(content, jid, bot) {
        if (!bot.sock || !this.enableTypingIndicators) {
            return await bot.sock?.sendMessage(jid, content);
        }

        try {
            await bot.sock.presenceSubscribe(jid);
            await delay(500);

            await bot.sock.sendPresenceUpdate('composing', jid);
            await delay(2000);

            await bot.sock.sendPresenceUpdate('paused', jid);

            return await bot.sock.sendMessage(jid, content);
        } catch (error) {
            logger.warn('⚠️ Failed to send message with typing:', error.message);
            return await bot.sock.sendMessage(jid, content);
        }
    }

    async startTyping(jid, bot) {
        if (!this.enableTypingIndicators || !bot.sock) return;

        try {
            await bot.sock.presenceSubscribe(jid);
            await bot.sock.sendPresenceUpdate('composing', jid);
        } catch (error) {
            logger.debug('Start typing failed (non-critical):', error.message);
        }
    }

    async stopTyping(jid, bot) {
        if (!this.enableTypingIndicators || !bot.sock) return;

        try {
            await bot.sock.sendPresenceUpdate('paused', jid);
        } catch (error) {
            logger.debug('Stop typing failed (non-critical):', error.message);
        }
    }

    async setPresence(status, jid, bot) {
        if (!this.presenceUpdates || !bot.sock) return;

        try {
            await bot.sock.sendPresenceUpdate(status, jid);
        } catch (error) {
            logger.debug('Set presence failed (non-critical):', error.message);
        }
    }
}

module.exports = PresenceModule;
