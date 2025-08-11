
const config = require('../config');
const logger = require('../Core/logger');

class AssistantModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'assistant';
        this.metadata = {
            description: 'AI-powered assistant that helps users with commands and provides smart suggestions',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'ai'
        };

        // Assistant state
        this.isEnabled = false;
        this.userPreferences = new Map();
        this.commandHistory = new Map();
        this.learningData = new Map();

        this.commands = [
            {
                name: 'assistant',
                description: 'Toggle AI assistant on/off',
                usage: '.assistant on/off',
                aliases: ['jarvis', 'ai-assistant'],
                permissions: 'admin',
                execute: this.toggleAssistant.bind(this)
            },
            {
                name: 'suggest',
                description: 'Get command suggestions',
                usage: '.suggest <what you want to do>',
                permissions: 'public',
                execute: this.getSuggestions.bind(this)
            },
            {
                name: 'learn',
                description: 'Teach assistant new command patterns',
                usage: '.learn <pattern> <command>',
                permissions: 'admin',
                execute: this.learnPattern.bind(this)
            },
            {
                name: 'assistant-stats',
                description: 'Show assistant statistics',
                usage: '.assistant-stats',
                permissions: 'admin',
                execute: this.getStats.bind(this)
            }
        ];

        // Message hooks
        this.messageHooks = {
            'pre_process': this.handleNaturalLanguage.bind(this)
        };
    }

    async init() {
        try {
            const db = this.bot.db;
            const collection = db.collection('assistant_data');
            
            const settings = await collection.findOne({ type: 'settings' });
            if (settings) {
                this.isEnabled = settings.enabled || false;
            }
            
            const patterns = await collection.find({ type: 'learned_pattern' }).toArray();
            for (const pattern of patterns) {
                this.learningData.set(pattern.pattern, pattern.command);
            }
            
            logger.info('✅ Assistant module initialized');
        } catch (error) {
            logger.error('❌ Failed to initialize assistant:', error);
        }
    }

    async toggleAssistant(msg, params, context) {
        const action = params[0]?.toLowerCase();
        
        if (!action || !['on', 'off', 'enable', 'disable'].includes(action)) {
            return `🤖 **Assistant Status:** ${this.isEnabled ? '✅ Enabled' : '❌ Disabled'}\n\nUsage: .assistant on/off`;
        }

        this.isEnabled = ['on', 'enable'].includes(action);
        
        try {
            const db = this.bot.db;
            const collection = db.collection('assistant_data');
            await collection.updateOne(
                { type: 'settings' },
                { $set: { enabled: this.isEnabled, updatedAt: new Date() } },
                { upsert: true }
            );
        } catch (error) {
            logger.error('❌ Failed to save assistant settings:', error);
        }

        const statusText = this.isEnabled ? 
            '🤖 **Assistant Enabled!**\n\n✨ I\'m now ready to help you with:\n• Natural language commands\n• Smart suggestions\n• Command guidance\n• Learning your preferences\n\nJust talk to me naturally!' :
            '🤖 **Assistant Disabled**\n\nI\'ll no longer process natural language or provide suggestions.';

        return statusText;
    }

    async handleNaturalLanguage(msg, text, bot) {
        if (!this.isEnabled || !text || text.startsWith(config.get('bot.prefix'))) return;
        
        if (msg.key.fromMe) return;

        const userId = (msg.key.participant || msg.key.remoteJid).split('@')[0];
        const lowerText = text.toLowerCase().trim();

        const detectedCommand = this.detectCommand(lowerText);
        
        if (detectedCommand) {
            logger.info(`🤖 Assistant detected command: ${detectedCommand.command} from text: "${text}"`);
            
            try {
                this.trackCommandUsage(userId, detectedCommand.command, text);
                await this.executeDetectedCommand(msg, detectedCommand, bot);
                
            } catch (error) {
                logger.error('❌ Assistant command execution failed:', error);
                
                await bot.sendMessage(msg.key.remoteJid, {
                    text: `🤖 I understood you wanted to use **${detectedCommand.command}**, but something went wrong.\n\n💡 Try: \`.${detectedCommand.command} ${detectedCommand.suggestion || ''}\``
                });
            }
        } else if (this.looksLikeCommandRequest(lowerText)) {
            const suggestions = this.generateSuggestions(lowerText);
            if (suggestions.length > 0) {
                await this.sendSuggestions(msg.key.remoteJid, lowerText, suggestions, bot);
            }
        }
    }

    detectCommand(text) {
        // Get all available commands from the bot
        const availableCommands = this.getAllAvailableCommands();
        
        // Check learned patterns first
        for (const [pattern, command] of this.learningData) {
            if (this.matchesPattern(text, pattern)) {
                return {
                    command,
                    pattern,
                    confidence: this.calculateConfidence(text, pattern),
                    suggestion: this.generateCommandSuggestion(command, text)
                };
            }
        }

        // Check built-in patterns
        const patterns = this.getBuiltInPatterns();
        for (const [command, commandPatterns] of Object.entries(patterns)) {
            if (availableCommands.includes(command)) {
                for (const pattern of commandPatterns) {
                    if (this.matchesPattern(text, pattern)) {
                        return {
                            command,
                            pattern,
                            confidence: this.calculateConfidence(text, pattern),
                            suggestion: this.generateCommandSuggestion(command, text)
                        };
                    }
                }
            }
        }
        
        return null;
    }

    getAllAvailableCommands() {
        const commands = [];
        
        // Get commands from all loaded modules
        for (const [moduleName, moduleInfo] of this.bot.moduleLoader.modules) {
            if (moduleInfo.instance.commands) {
                for (const cmd of moduleInfo.instance.commands) {
                    commands.push(cmd.name);
                    if (cmd.aliases) {
                        commands.push(...cmd.aliases);
                    }
                }
            }
        }
        
        return commands;
    }

    getBuiltInPatterns() {
        return {
            // Time related
            'time': ['time', 'what time', 'current time', 'whats the time', 'tell me time', 'time in'],
            'weather': ['weather', 'temperature', 'forecast', 'climate', 'how hot', 'how cold', 'weather in'],
            
            // Media
            'sticker': ['sticker', 'make sticker', 'create sticker', 'convert to sticker'],
            'toimg': ['to image', 'sticker to image', 'convert sticker'],
            'tovn': ['voice note', 'to voice', 'voice message', 'convert to voice'],
            'download': ['download', 'get video', 'get audio', 'youtube', 'tiktok', 'instagram'],
            
            // AI
            'ai': ['ai', 'ask ai', 'gemini', 'chat', 'question', 'help me understand'],
            'translate': ['translate', 'translation', 'convert language', 'what does this mean', 'translate to'],
            
            // Utility
            'ping': ['ping', 'test', 'check bot', 'are you working', 'status check'],
            'help': ['help', 'commands', 'what can you do', 'how to use', 'guide'],
            
            // Search
            'google': ['google', 'search', 'find', 'look up', 'search for'],
            'images': ['image', 'picture', 'photo', 'find image', 'show me'],
            
            // Conversion
            'currency': ['currency', 'exchange rate', 'convert money', 'dollars to', 'price in'],
            'length': ['convert length', 'meters to', 'feet to', 'cm to'],
            'weight': ['convert weight', 'kg to', 'pounds to', 'grams to'],
            'temp': ['temperature', 'celsius to', 'fahrenheit to', 'convert temp'],
            
            // Group management
            'promote': ['promote', 'make admin', 'give admin'],
            'kick': ['kick', 'remove', 'ban user'],
            'mute': ['mute group', 'silence group'],
            
            // System
            'status': ['bot status', 'system status', 'how are you'],
            'restart': ['restart bot', 'reboot', 'restart system']
        };
    }

    matchesPattern(text, pattern) {
        const textWords = text.toLowerCase().split(' ');
        const patternWords = pattern.toLowerCase().split(' ');
        
        // Exact match
        if (text.toLowerCase().includes(pattern.toLowerCase())) {
            return true;
        }
        
        // Fuzzy match
        const matchedWords = patternWords.filter(word => 
            textWords.some(textWord => 
                textWord.includes(word) || word.includes(textWord) || 
                this.calculateSimilarity(textWord, word) > 0.7
            )
        );
        
        return matchedWords.length >= Math.ceil(patternWords.length * 0.6);
    }

    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    calculateConfidence(text, pattern) {
        const textWords = text.toLowerCase().split(' ');
        const patternWords = pattern.toLowerCase().split(' ');
        
        const matchedWords = patternWords.filter(word => 
            textWords.some(textWord => textWord.includes(word))
        );
        
        return matchedWords.length / patternWords.length;
    }

    generateCommandSuggestion(command, originalText) {
        const extractors = {
            'time': () => this.extractLocationFromText(originalText) || '',
            'weather': () => this.extractLocationFromText(originalText) || '',
            'translate': () => this.extractLanguageFromText(originalText),
            'currency': () => this.extractCurrencyFromText(originalText),
            'google': () => this.extractSearchQuery(originalText),
            'ai': () => this.extractQuestionFromText(originalText),
            'images': () => this.extractSearchQuery(originalText)
        };
        
        return extractors[command] ? extractors[command]() : '';
    }

    extractLocationFromText(text) {
        const locationWords = ['in', 'at', 'for', 'of'];
        const words = text.split(' ');
        
        for (let i = 0; i < words.length; i++) {
            if (locationWords.includes(words[i].toLowerCase()) && words[i + 1]) {
                return words.slice(i + 1).join(' ').replace(/[?!.]/g, '');
            }
        }
        
        return null;
    }

    extractLanguageFromText(text) {
        const languages = {
            'spanish': 'es', 'french': 'fr', 'german': 'de', 'italian': 'it',
            'portuguese': 'pt', 'russian': 'ru', 'chinese': 'zh', 'japanese': 'ja',
            'korean': 'ko', 'arabic': 'ar', 'hindi': 'hi', 'urdu': 'ur'
        };
        
        for (const [lang, code] of Object.entries(languages)) {
            if (text.toLowerCase().includes(lang)) {
                return code;
            }
        }
        
        return 'en';
    }

    extractCurrencyFromText(text) {
        const currencies = ['usd', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'chf', 'cny', 'inr', 'pkr'];
        const words = text.toLowerCase().split(' ');
        
        const foundCurrencies = words.filter(word => currencies.includes(word));
        if (foundCurrencies.length >= 2) {
            return `100 ${foundCurrencies[0]} ${foundCurrencies[1]}`;
        }
        
        return '100 usd eur';
    }

    extractSearchQuery(text) {
        const searchWords = ['search', 'find', 'look up', 'google', 'show me'];
        let query = text;
        
        for (const word of searchWords) {
            query = query.replace(new RegExp(word, 'gi'), '').trim();
        }
        
        return query || 'search query';
    }

    extractQuestionFromText(text) {
        return text.replace(/^(ask|tell me|what is|how to|can you)/gi, '').trim();
    }

    async executeDetectedCommand(msg, detectedCommand, bot) {
        const { command, suggestion } = detectedCommand;
        const prefix = config.get('bot.prefix');
        
        const handler = bot.messageHandler.commandHandlers.get(command);
        if (!handler) {
            throw new Error(`Command ${command} not found`);
        }
        
        const params = suggestion ? suggestion.split(' ').filter(p => p.length > 0) : [];
        
        const context = {
            bot: bot,
            sender: msg.key.remoteJid,
            participant: msg.key.participant || msg.key.remoteJid,
            isGroup: msg.key.remoteJid.endsWith('@g.us')
        };
        
        try {
            await bot.sock.sendMessage(msg.key.remoteJid, {
                react: { key: msg.key, text: '🤖' }
            });
        } catch (error) {
            // Ignore reaction errors
        }
        
        await handler.execute(msg, params, context);
        
        try {
            await bot.sock.sendMessage(msg.key.remoteJid, {
                react: { key: msg.key, text: '' }
            });
        } catch (error) {
            // Ignore reaction errors
        }
    }

    looksLikeCommandRequest(text) {
        const commandIndicators = [
            'how to', 'can you', 'please', 'help me', 'i want to', 'i need to',
            'show me', 'tell me', 'what is', 'how do i', 'make', 'create',
            'convert', 'translate', 'search', 'find', 'download', 'get'
        ];
        
        return commandIndicators.some(indicator => 
            text.toLowerCase().includes(indicator)
        );
    }

    generateSuggestions(text) {
        const suggestions = [];
        const words = text.toLowerCase().split(' ');
        const availableCommands = this.getAllAvailableCommands();
        const patterns = this.getBuiltInPatterns();
        
        for (const [command, commandPatterns] of Object.entries(patterns)) {
            if (availableCommands.includes(command)) {
                for (const pattern of commandPatterns) {
                    const patternWords = pattern.toLowerCase().split(' ');
                    const commonWords = words.filter(word => 
                        patternWords.some(pWord => pWord.includes(word) || word.includes(pWord))
                    );
                    
                    if (commonWords.length > 0) {
                        suggestions.push({
                            command,
                            pattern,
                            relevance: commonWords.length / patternWords.length,
                            usage: this.getCommandUsage(command)
                        });
                    }
                }
            }
        }
        
        return suggestions
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 3);
    }

    async sendSuggestions(jid, originalText, suggestions, bot) {
        let suggestionText = `🤖 **I think you might want to:**\n\n`;
        
        suggestions.forEach((suggestion, index) => {
            suggestionText += `${index + 1}. **${suggestion.command}** - ${suggestion.usage}\n`;
        });
        
        suggestionText += `\n💡 *Based on: "${originalText}"*\n`;
        suggestionText += `\nType \`.help ${suggestions[0].command}\` for more details!`;
        
        await bot.sendMessage(jid, { text: suggestionText });
    }

    getCommandUsage(command) {
        const usages = {
            'time': 'Get current time for any city',
            'weather': 'Check weather conditions',
            'ai': 'Ask AI questions',
            'translate': 'Translate text to any language',
            'sticker': 'Create stickers from images',
            'download': 'Download videos from social media',
            'google': 'Search the web',
            'currency': 'Convert currencies',
            'length': 'Convert length units',
            'weight': 'Convert weight units',
            'temp': 'Convert temperature',
            'ping': 'Test bot response time',
            'help': 'Get help with commands'
        };
        
        return usages[command] || 'Execute command';
    }

    trackCommandUsage(userId, command, originalText) {
        if (!this.commandHistory.has(userId)) {
            this.commandHistory.set(userId, []);
        }
        
        const history = this.commandHistory.get(userId);
        history.push({
            command,
            originalText,
            timestamp: Date.now()
        });
        
        // Keep only recent history
        if (history.length > 50) {
            history.shift();
        }
    }

    async getSuggestions(msg, params, context) {
        if (params.length === 0) {
            return '❌ Please provide what you want to do.\nExample: .suggest I want to download a video';
        }

        const query = params.join(' ');
        const suggestions = this.generateSuggestions(query);
        
        if (suggestions.length === 0) {
            return '❌ No suggestions found. Try being more specific about what you want to do.';
        }

        let suggestionText = `💡 **Suggestions for: "${query}"**\n\n`;
        
        suggestions.forEach((suggestion, index) => {
            suggestionText += `${index + 1}. **.${suggestion.command}** - ${suggestion.usage}\n`;
        });
        
        suggestionText += `\nUse \`.help <command>\` for detailed usage instructions.`;
        
        return suggestionText;
    }

    async learnPattern(msg, params, context) {
        if (params.length < 2) {
            return '❌ Usage: .learn <pattern> <command>\nExample: .learn "get weather" weather';
        }

        const pattern = params[0];
        const command = params[1];
        
        // Verify command exists
        const availableCommands = this.getAllAvailableCommands();
        if (!availableCommands.includes(command)) {
            return `❌ Command "${command}" not found. Available commands: ${availableCommands.slice(0, 10).join(', ')}...`;
        }

        try {
            this.learningData.set(pattern, command);
            
            const db = this.bot.db;
            const collection = db.collection('assistant_data');
            await collection.updateOne(
                { type: 'learned_pattern', pattern },
                { $set: { command, updatedAt: new Date() } },
                { upsert: true }
            );
            
            return `✅ **Pattern Learned**\n\nPattern: "${pattern}"\nCommand: ${command}\n\nNow I'll recognize this pattern in natural language!`;
            
        } catch (error) {
            logger.error('❌ Failed to learn pattern:', error);
            return `❌ Failed to learn pattern: ${error.message}`;
        }
    }

    async getStats(msg, params, context) {
        const totalPatterns = this.learningData.size;
        const totalUsers = this.commandHistory.size;
        const totalCommands = Array.from(this.commandHistory.values())
            .reduce((total, history) => total + history.length, 0);
        
        let statsText = `📊 **Assistant Statistics**\n\n`;
        statsText += `🤖 Status: ${this.isEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;
        statsText += `🧠 Learned Patterns: ${totalPatterns}\n`;
        statsText += `👥 Users Helped: ${totalUsers}\n`;
        statsText += `⚡ Commands Executed: ${totalCommands}\n`;
        
        if (totalUsers > 0) {
            const recentActivity = Array.from(this.commandHistory.values())
                .flat()
                .filter(entry => Date.now() - entry.timestamp < 86400000) // Last 24 hours
                .length;
            
            statsText += `📈 Recent Activity (24h): ${recentActivity}\n`;
        }
        
        return statsText;
    }
}

module.exports = AssistantModule;
