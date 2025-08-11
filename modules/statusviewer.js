const config = require('../config');
const logger = require('../Core/logger');

class StatusViewerModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'statusviewer';
        this.metadata = {
            description: 'Automatically view and react to WhatsApp status updates',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'automation'
        };

        // Configuration
        this.autoViewStatus = config.get('features.autoViewStatus', false);
        this.autoReactStatus = config.get('features.autoReactStatus', false);
        this.statusReaction = config.get('features.statusReaction', '❤️');
        this.viewDelay = config.get('features.statusViewDelay', 1000);
        
        // Status viewing statistics
        this.viewedStatuses = new Map();
        this.totalViewed = 0;
        this.totalReacted = 0;

        this.commands = [
            {
                name: 'autostatus',
                description: 'Toggle auto status viewing',
                usage: '.autostatus on/off',
                permissions: 'owner',
                execute: this.toggleAutoStatus.bind(this)
            },
            {
                name: 'statusreact',
                description: 'Toggle auto status reactions',
                usage: '.statusreact on/off',
                permissions: 'owner',
                execute: this.toggleStatusReact.bind(this)
            },
            {
                name: 'setreaction',
                description: 'Set status reaction emoji',
                usage: '.setreaction <emoji>',
                permissions: 'owner',
                execute: this.setStatusReaction.bind(this)
            },
            {
                name: 'statusstats',
                description: 'Show status viewing statistics',
                usage: '.statusstats',
                permissions: 'owner',
                execute: this.showStatusStats.bind(this)
            },
            {
                name: 'statusconfig',
                description: 'Show status viewer configuration',
                usage: '.statusconfig',
                permissions: 'owner',
                execute: this.showStatusConfig.bind(this)
            }
        ];

        // Message hooks for status handling
        this.messageHooks = {
            'pre_process': this.handleStatusMessage.bind(this)
        };
    }

    async toggleAutoStatus(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `👁️ *Auto Status Viewing*\n\nCurrent: ${this.autoViewStatus ? 'ON' : 'OFF'}\nViewed: ${this.totalViewed}\n\nUsage: .autostatus on/off`;
        }

        this.autoViewStatus = action === 'on';
        config.set('features.autoViewStatus', this.autoViewStatus);
        
        return `👁️ Auto status viewing ${this.autoViewStatus ? 'enabled' : 'disabled'}`;
    }

    async toggleStatusReact(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off'].includes(action)) {
            return `❤️ *Auto Status Reactions*\n\nCurrent: ${this.autoReactStatus ? 'ON' : 'OFF'}\nReaction: ${this.statusReaction}\nReacted: ${this.totalReacted}\n\nUsage: .statusreact on/off`;
        }

        this.autoReactStatus = action === 'on';
        config.set('features.autoReactStatus', this.autoReactStatus);
        
        return `❤️ Auto status reactions ${this.autoReactStatus ? 'enabled' : 'disabled'}`;
    }

    async setStatusReaction(msg, params, context) {
        if (params.length === 0) {
            return `❤️ *Status Reaction*\n\nCurrent: ${this.statusReaction}\n\nUsage: .setreaction <emoji>\nExample: .setreaction 👍`;
        }

        this.statusReaction = params[0];
        config.set('features.statusReaction', this.statusReaction);
        
        return `❤️ Status reaction set to: ${this.statusReaction}`;
    }

    async showStatusStats(msg, params, context) {
        let statsText = `📊 *Status Viewing Statistics*\n\n`;
        statsText += `👁️ Total Viewed: ${this.totalViewed}\n`;
        statsText += `❤️ Total Reacted: ${this.totalReacted}\n`;
        statsText += `📱 Unique Users: ${this.viewedStatuses.size}\n\n`;
        
        if (this.viewedStatuses.size > 0) {
            statsText += `📋 *Recent Activity:*\n`;
            const recent = [...this.viewedStatuses.entries()].slice(-5);
            for (const [user, count] of recent) {
                const contact = this.bot.getContactInfo?.(user) || {};
                const name = contact.name || user.split('@')[0];
                statsText += `• ${name}: ${count} statuses\n`;
            }
        }
        
        return statsText;
    }

    async showStatusConfig(msg, params, context) {
        let configText = `⚙️ *Status Viewer Configuration*\n\n`;
        configText += `👁️ Auto View: ${this.autoViewStatus ? '✅ Enabled' : '❌ Disabled'}\n`;
        configText += `❤️ Auto React: ${this.autoReactStatus ? '✅ Enabled' : '❌ Disabled'}\n`;
        configText += `😀 Reaction: ${this.statusReaction}\n`;
        configText += `⏱️ View Delay: ${this.viewDelay}ms\n\n`;
        configText += `📊 *Statistics:*\n`;
        configText += `• Viewed: ${this.totalViewed}\n`;
        configText += `• Reacted: ${this.totalReacted}\n`;
        configText += `• Users: ${this.viewedStatuses.size}\n\n`;
        configText += `💡 Use .autostatus, .statusreact, .setreaction to configure`;
        
        return configText;
    }

    async handleStatusMessage(msg, text, bot) {
        // Check if it's a status message
        if (msg.key.remoteJid !== 'status@broadcast') return;

        // Skip if auto view is disabled
        if (!this.autoViewStatus) return;

        const participant = msg.key.participant;
        if (!participant) return;

        try {
            // Add delay before viewing
            if (this.viewDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, this.viewDelay));
            }

            // Mark status as read
            await bot.sock.readMessages([msg.key]);
            
            // React to status if enabled
            if (this.autoReactStatus) {
                await bot.sock.sendMessage(msg.key.remoteJid, {
                    react: { key: msg.key, text: this.statusReaction }
                });
                this.totalReacted++;
            }

            // Update statistics
            this.totalViewed++;
            const currentCount = this.viewedStatuses.get(participant) || 0;
            this.viewedStatuses.set(participant, currentCount + 1);

            // Get contact info for logging
            const contact = bot.getContactInfo?.(participant) || {};
            const name = contact.name || participant.split('@')[0];
            
            logger.debug(`👁️ Viewed status from ${name}${this.autoReactStatus ? ` and reacted with ${this.statusReaction}` : ''}`);

            // Log to Telegram if bridge is available
            if (bot.telegramBridge) {
                try {
                    const statusType = msg.message?.imageMessage ? 'image' : 
                                     msg.message?.videoMessage ? 'video' : 
                                     msg.message?.audioMessage ? 'audio' : 'text';
                    
                    await bot.telegramBridge.logToTelegram('👁️ Status Viewed', 
                        `User: ${name}\nType: ${statusType}${this.autoReactStatus ? `\nReacted: ${this.statusReaction}` : ''}`);
                } catch (error) {
                    logger.debug('Telegram status log failed (non-critical):', error.message);
                }
            }

        } catch (error) {
            logger.error('❌ Status viewing failed:', error);
        }
    }

    // Method to get status statistics for a specific user
    getUserStatusStats(participant) {
        return {
            viewCount: this.viewedStatuses.get(participant) || 0,
            hasViewed: this.viewedStatuses.has(participant)
        };
    }

    // Method to clear status statistics
    clearStatusStats() {
        this.viewedStatuses.clear();
        this.totalViewed = 0;
        this.totalReacted = 0;
        logger.info('🧹 Status statistics cleared');
    }

    // Method to export status statistics
    exportStatusStats() {
        return {
            totalViewed: this.totalViewed,
            totalReacted: this.totalReacted,
            uniqueUsers: this.viewedStatuses.size,
            userStats: Object.fromEntries(this.viewedStatuses),
            config: {
                autoViewStatus: this.autoViewStatus,
                autoReactStatus: this.autoReactStatus,
                statusReaction: this.statusReaction,
                viewDelay: this.viewDelay
            },
            exportedAt: new Date().toISOString()
        };
    }
}

module.exports = StatusViewerModule;
