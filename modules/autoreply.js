const config = require('../config');
const logger = require('../Core/logger');
const { isJidNewsletter } = require('@whiskeysockets/baileys');

class AutoReplyModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'autoreply';
        this.metadata = {
            description: 'Automatic reply system with customizable messages and conditions',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'automation'
        };

        // Configuration
        this.autoReply = config.get('features.autoReply', false);
        this.autoReplyText = config.get('messages.autoReplyText', 'Hello there! This is an automated response.');
        this.replyDelay = config.get('features.autoReplyDelay', 2000);
        
        // Auto reply conditions
        this.excludeGroups = config.get('autoReply.excludeGroups', true);
        this.excludeNewsletters = config.get('autoReply.excludeNewsletters', true);
        this.onlyFirstMessage = config.get('autoReply.onlyFirstMessage', false);
        
        // Track replied users to avoid spam
        this.repliedUsers = new Set();
        this.resetInterval = 24 * 60 * 60 * 1000; // 24 hours
        
        // Reset replied users daily
        setInterval(() => {
            this.repliedUsers.clear();
            logger.debug('🔄 Auto-reply user cache cleared');
        }, this.resetInterval);

        this.commands = [
            {
                name: 'autoreply',
                description: 'Toggle auto reply feature',
                usage: '.autoreply on/off',
                permissions: 'owner',
                execute: this.toggleAutoReply.bind(this)
            },
            {
                name: 'setreply',
                description: 'Set auto reply message',
                usage: '.setreply <message>',
                permissions: 'owner',
                execute: this.setReplyMessage.bind(this)
            },
            {
                name: 'replyconfig',
                description: 'Configure auto reply settings',
                usage: '.replyconfig',
                permissions: 'owner',
                execute: this.showReplyConfig.bind(this)
            },
            {
                name: 'replydelay',
                description: 'Set auto reply delay in milliseconds',
                usage: '.replydelay <ms>',
                permissions: 'owner',
                execute: this.setReplyDelay.bind(this)
            }
        ];

        // Message hooks for auto reply
        this.messageHooks = {
            'pre_process': this.handleAutoReply.bind(this)
        };
    }

    async toggleAutoReply(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `🤖 *Auto Reply*\n\nCurrent: ${this.autoReply ? 'ON' : 'OFF'}\nMessage: "${this.autoReplyText}"\nDelay: ${this.replyDelay}ms\n\nUsage: .autoreply on/off`;
        }

        this.autoReply = action === 'on';
        config.set('features.autoReply', this.autoReply);
        
        return `🤖 Auto reply ${this.autoReply ? 'enabled' : 'disabled'}`;
    }

    async setReplyMessage(msg, params, context) {
        if (params.length === 0) {
            return `📝 *Set Auto Reply Message*\n\nCurrent: "${this.autoReplyText}"\n\nUsage: .setreply <message>`;
        }

        this.autoReplyText = params.join(' ');
        config.set('messages.autoReplyText', this.autoReplyText);
        
        return `📝 Auto reply message updated:\n"${this.autoReplyText}"`;
    }

    async setReplyDelay(msg, params, context) {
        if (params.length === 0) {
            return `⏱️ *Auto Reply Delay*\n\nCurrent: ${this.replyDelay}ms\n\nUsage: .replydelay <milliseconds>`;
        }

        const delay = parseInt(params[0]);
        if (isNaN(delay) || delay < 0) {
            return `❌ Invalid delay. Please provide a number in milliseconds (0 or higher).`;
        }

        this.replyDelay = delay;
        config.set('features.autoReplyDelay', this.replyDelay);
        
        return `⏱️ Auto reply delay set to ${this.replyDelay}ms`;
    }

    async showReplyConfig(msg, params, context) {
        let configText = `⚙️ *Auto Reply Configuration*\n\n`;
        configText += `🤖 Status: ${this.autoReply ? '✅ Enabled' : '❌ Disabled'}\n`;
        configText += `📝 Message: "${this.autoReplyText}"\n`;
        configText += `⏱️ Delay: ${this.replyDelay}ms\n`;
        configText += `👥 Exclude Groups: ${this.excludeGroups ? '✅' : '❌'}\n`;
        configText += `📰 Exclude Newsletters: ${this.excludeNewsletters ? '✅' : '❌'}\n`;
        configText += `🔢 Only First Message: ${this.onlyFirstMessage ? '✅' : '❌'}\n`;
        configText += `📊 Replied Users: ${this.repliedUsers.size}\n\n`;
        configText += `💡 Use .autoreply, .setreply, .replydelay to configure`;
        
        return configText;
    }

    async handleAutoReply(msg, text, bot) {
        // Skip if auto reply is disabled
        if (!this.autoReply) return;

        // Skip own messages
        if (msg.key.fromMe) return;

        // Skip if no text content
        if (!text) return;

        // Skip commands
        if (text.startsWith(config.get('bot.prefix'))) return;

        const sender = msg.key.remoteJid;
        const participant = msg.key.participant || sender;
        const isGroup = sender.endsWith('@g.us');
        const isNewsletter = isJidNewsletter(sender);

        // Apply exclusion rules
        if (this.excludeGroups && isGroup) return;
        if (this.excludeNewsletters && isNewsletter) return;

        // Check if we should only reply to first message
        if (this.onlyFirstMessage && this.repliedUsers.has(participant)) return;

        try {
            // Get presence module for typing indicators
            const presenceModule = bot.moduleLoader.getModule('presence');
            
            // Start typing if presence module is available
            if (presenceModule) {
                await presenceModule.startTyping(sender, bot);
            }

            // Add delay if configured
            if (this.replyDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, this.replyDelay));
            }

            // Personalize reply based on user stats if store is available
            let replyText = this.autoReplyText;
            
            if (bot.getUserStats) {
                const userStats = bot.getUserStats(participant);
                const contactInfo = bot.getContactInfo(participant);
                
                if (userStats.messageCount > 10) {
                    replyText += `\n\nGood to hear from you again! 👋`;
                } else if (userStats.messageCount === 0) {
                    replyText += `\n\nWelcome! This seems to be your first message. 🎉`;
                }
            }

            // Send auto reply
            await bot.sendMessage(sender, { text: replyText });

            // Stop typing if presence module is available
            if (presenceModule) {
                await presenceModule.stopTyping(sender, bot);
                await presenceModule.setPresence('available', sender, bot);
            }

            // Mark user as replied to
            this.repliedUsers.add(participant);

            logger.info(`🤖 Auto-replied to: ${participant}`);

        } catch (error) {
            logger.error('❌ Auto reply failed:', error);
        }
    }

    // Method to clear replied users cache
    clearRepliedUsers() {
        this.repliedUsers.clear();
        logger.info('🧹 Auto-reply user cache cleared manually');
    }

    // Method to check if user has been replied to
    hasRepliedTo(participant) {
        return this.repliedUsers.has(participant);
    }

    // Method to add user to replied list
    markAsReplied(participant) {
        this.repliedUsers.add(participant);
    }
}

module.exports = AutoReplyModule;
