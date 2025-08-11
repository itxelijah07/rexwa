const logger = require('./logger');
const config = require('../config');
const rateLimiter = require('./rate-limiter');
const { delay } = require('@whiskeysockets/baileys');

class MessageHandler {
    constructor(bot) {
        this.bot = bot;
        this.commandHandlers = new Map();
        this.messageHooks = new Map();
    }

    registerCommandHandler(command, handler) {
        this.commandHandlers.set(command.toLowerCase(), handler);
        logger.debug(`📝 Registered command handler: ${command}`);
    }

    unregisterCommandHandler(command) {
        this.commandHandlers.delete(command.toLowerCase());
        logger.debug(`🗑️ Unregistered command handler: ${command}`);
    }

    registerMessageHook(hookName, handler) {
        if (!this.messageHooks.has(hookName)) {
            this.messageHooks.set(hookName, []);
        }
        this.messageHooks.get(hookName).push(handler);
        logger.debug(`🪝 Registered message hook: ${hookName}`);
    }

    unregisterMessageHook(hookName) {
        this.messageHooks.delete(hookName);
        logger.debug(`🗑️ Unregistered message hook: ${hookName}`);
    }

    async processMessage(msg) {
        try {
            // Handle status messages
            if (msg.key.remoteJid === 'status@broadcast') {
                return this.handleStatusMessage(msg);
            }

            // Extract text from message (including captions)
            const text = this.extractText(msg);
            
            // Check if it's a command (only for text messages, not media with captions)
            const prefix = config.get('bot.prefix');
            const isCommand = text && text.startsWith(prefix) && !this.hasMedia(msg);
            
            // Execute message hooks
            await this.executeMessageHooks('pre_process', msg, text);
            
            if (isCommand) {
                await this.handleCommand(msg, text);
            } else {
                // Handle non-command messages (including media)
                await this.handleNonCommandMessage(msg, text);
            }

            // Execute post-process hooks
            await this.executeMessageHooks('post_process', msg, text);

            // FIXED: ALWAYS sync to Telegram if bridge is active (this was the main issue)
            if (this.bot.telegramBridge) {
                await this.bot.telegramBridge.syncMessage(msg, text);
            }
        } catch (error) {
            logger.error('Error processing message:', {
                messageId: msg.key?.id,
                remoteJid: msg.key?.remoteJid,
                error: error.message,
                stack: error.stack
            });
        }
    }

    async handleMessages({ messages, type }) {
        if (type !== 'notify') return;

        // Process messages concurrently but with limit to avoid overwhelming
        const concurrencyLimit = 5;
        const messageQueue = [...messages];
        
        while (messageQueue.length > 0) {
            const batch = messageQueue.splice(0, concurrencyLimit);
            await Promise.allSettled(
                batch.map(msg => this.processMessage(msg))
            );
        }
    }

    async executeMessageHooks(hookName, msg, text) {
        const hooks = this.messageHooks.get(hookName) || [];
        for (const hook of hooks) {
            try {
                await hook(msg, text, this.bot);
            } catch (error) {
                logger.error(`Error executing hook ${hookName}:`, error);
            }
        }
    }

    async handleStatusMessage(msg) {
        // Let status viewer module handle this
        await this.executeMessageHooks('pre_process', msg, this.extractText(msg));
    }

    // New method to check if message has media
    hasMedia(msg) {
        return !!(
            msg.message?.imageMessage ||
            msg.message?.videoMessage ||
            msg.message?.audioMessage ||
            msg.message?.documentMessage ||
            msg.message?.stickerMessage ||
            msg.message?.locationMessage ||
            msg.message?.contactMessage
        );
    }

async handleCommand(msg, text) {
    const sender = msg.key.remoteJid;
    const participant = msg.key.participant || sender;
    const prefix = config.get('bot.prefix');

    const args = text.slice(prefix.length).trim().split(/\s+/);
    const command = args[0].toLowerCase();
    const params = args.slice(1);

    // Get presence module for typing indicators
    const presenceModule = this.bot.moduleLoader.getModule('presence');
    
    // Start typing if presence module is available
    if (presenceModule) {
        await presenceModule.startTyping(sender, this.bot);
    }

    // Auto read messages if presence module is available
    if (presenceModule && presenceModule.autoReadMessages) {
        try {
            await this.bot.sock.readMessages([msg.key]);
        } catch (error) {
            logger.debug('Auto read failed (non-critical):', error.message);
        }
    }

if (!this.checkPermissions(msg, command)) {
    if (config.get('features.sendPermissionError', false)) {
        if (presenceModule) {
            await presenceModule.stopTyping(sender, this.bot);
        }
        return this.bot.sendMessage(sender, {
            text: '❌ You don\'t have permission to use this command.'
        });
    }
    if (presenceModule) {
        await presenceModule.stopTyping(sender, this.bot);
    }
    return; // silently ignore
}

    const userId = participant.split('@')[0];
    if (config.get('features.rateLimiting')) {
        const canExecute = await rateLimiter.checkCommandLimit(userId);
        if (!canExecute) {
            const remainingTime = await rateLimiter.getRemainingTime(userId);
            if (presenceModule) {
                await presenceModule.stopTyping(sender, this.bot);
            }
            return this.bot.sendMessage(sender, {
                text: `⏱️ Rate limit exceeded. Try again in ${Math.ceil(remainingTime / 1000)} seconds.`
            });
        }
    }

    const handler = this.commandHandlers.get(command);
    const respondToUnknown = config.get('features.respondToUnknownCommands', false);

    if (handler) {
        // Add reaction with error handling
        try {
            await this.bot.sock.sendMessage(sender, {
                react: { key: msg.key, text: '⏳' }
            });
        } catch (error) {
            logger.debug('Reaction failed (non-critical):', error.message);
        }

        try {
            // Add timeout to prevent hanging commands
            const commandTimeout = 30000; // 30 seconds
            const commandPromise = handler.execute(msg, params, {
                bot: this.bot,
                sender,
                participant,
                isGroup: sender.endsWith('@g.us')
            });
            
            await Promise.race([
                commandPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout')), commandTimeout)
                )
            ]);

            // Clear typing indicator on success
            if (presenceModule) {
                await presenceModule.stopTyping(sender, this.bot);
                await presenceModule.setPresence('available', sender, this.bot);
            }

            // Clear reaction on success for ALL commands
            try {
                await this.bot.sock.sendMessage(sender, {
                    react: { key: msg.key, text: '' }
                });
            } catch (error) {
                logger.debug('Reaction failed (non-critical):', error.message);
            }

            logger.info(`✅ Command executed: ${command} by ${participant}`);

            if (this.bot.telegramBridge) {
                try {
                    await this.bot.telegramBridge.logToTelegram('📝 Command Executed',
                        `Command: ${command}\nUser: ${participant}\nChat: ${sender}`);
                } catch (error) {
                    logger.debug('Telegram logging failed (non-critical):', error.message);
                }
            }

        } catch (error) {
            // Clear typing indicator on error
            if (presenceModule) {
                await presenceModule.stopTyping(sender, this.bot);
            }

            // Keep ❌ reaction on error (don't clear it)
            try {
                await this.bot.sock.sendMessage(sender, {
                    react: { key: msg.key, text: '❌' }
                });
            } catch (error) {
                logger.debug('Reaction failed (non-critical):', error.message);
            }

            logger.error(`❌ Command failed: ${command} | ${error.message || 'No message'}`);
            logger.debug(error.stack || error);

            if (!error._handledBySmartError && error?.message) {
                try {
                    await this.bot.sendMessage(sender, {
                        text: `❌ Command failed: ${error.message}`
                    });
                } catch (sendError) {
                    logger.error('Failed to send error message:', sendError.message);
                }
            }

            if (this.bot.telegramBridge) {
                try {
                    await this.bot.telegramBridge.logToTelegram('❌ Command Error',
                        `Command: ${command}\nError: ${error.message}\nUser: ${participant}`);
                } catch (logError) {
                    logger.debug('Telegram error logging failed (non-critical):', logError.message);
                }
            }
        }
    } else if (respondToUnknown) {
        if (presenceModule) {
            await presenceModule.stopTyping(sender, this.bot);
        }
        await this.bot.sendMessage(sender, {
            text: `❓ Unknown command: ${command}\nType *${prefix}menu* for available commands.`
        });
    } else {
        if (presenceModule) {
            await presenceModule.stopTyping(sender, this.bot);
        }
    }
}

    async handleNonCommandMessage(msg, text) {
        // Log media messages for debugging
        if (this.hasMedia(msg)) {
            const mediaType = this.getMediaType(msg);
            logger.debug(`📎 Media message received: ${mediaType} from ${msg.key.participant || msg.key.remoteJid}`);
        } else if (text) {
            logger.debug('💬 Text message received:', text.substring(0, 50));
        }
    }

    getMediaType(msg) {
        if (msg.message?.imageMessage) return 'image';
        if (msg.message?.videoMessage) return 'video';
        if (msg.message?.audioMessage) return 'audio';
        if (msg.message?.documentMessage) return 'document';
        if (msg.message?.stickerMessage) return 'sticker';
        if (msg.message?.locationMessage) return 'location';
        if (msg.message?.contactMessage) return 'contact';
        return 'unknown';
    }

checkPermissions(msg, commandName) {
    const participant = msg.key.participant || msg.key.remoteJid;
    const userId = participant.split('@')[0];
    const ownerId = config.get('bot.owner').split('@')[0]; // Convert full JID to userId
    const isOwner = userId === ownerId || msg.key.fromMe;

    const admins = config.get('bot.admins') || [];

    const mode = config.get('features.mode');
    if (mode === 'private' && !isOwner && !admins.includes(userId)) return false;

    const blockedUsers = config.get('security.blockedUsers') || [];
    if (blockedUsers.includes(userId)) return false;

    const handler = this.commandHandlers.get(commandName);
    if (!handler) return false;

    const permission = handler.permissions || 'public';

    switch (permission) {
        case 'owner':
            return isOwner;

        case 'admin':
            return isOwner || admins.includes(userId);

        case 'public':
            return true;

        default:
            if (Array.isArray(permission)) {
                return permission.includes(userId);
            }
            return false;
    }
}


    extractText(msg) {
        return msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption ||
               msg.message?.videoMessage?.caption || 
               msg.message?.documentMessage?.caption ||
               msg.message?.audioMessage?.caption ||
               '';
    }
}

module.exports = MessageHandler;
