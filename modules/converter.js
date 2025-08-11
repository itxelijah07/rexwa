const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');

const execAsync = promisify(exec);

class ConverterModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'converter';
        this.metadata = {
            description: 'Advanced media and unit converter with audio/video processing',
            version: '2.0.0',
            author: 'HyperWa Team',
            category: 'utility'
        };

        this.tempDir = path.join(__dirname, '../temp');
        this.ensureTempDir();

        // Exchange rates cache
        this.exchangeRates = null;
        this.ratesLastUpdated = 0;
        this.ratesCacheTime = 3600000; // 1 hour

        // Unit conversion definitions
        this.units = {
            length: {
                mm: 0.001,
                cm: 0.01,
                m: 1,
                km: 1000,
                in: 0.0254,
                ft: 0.3048,
                yd: 0.9144,
                mi: 1609.34
            },
            weight: {
                mg: 0.000001,
                g: 0.001,
                kg: 1,
                oz: 0.0283495,
                lb: 0.453592,
                ton: 1000
            },
            temperature: { // Special handling
                c: 'c',
                f: 'f',
                k: 'k'
            },
            area: {
                mm2: 0.000001,
                cm2: 0.0001,
                m2: 1,
                km2: 1000000,
                in2: 0.00064516,
                ft2: 0.092903,
                yd2: 0.836127,
                acre: 4046.86
            },
            volume: {
                ml: 0.001,
                l: 1,
                gal: 3.78541,
                qt: 0.946353,
                pt: 0.473176,
                cup: 0.236588,
                'fl_oz': 0.0295735
            }
        };

        this.commands = [
            // Media Converters
            {
                name: 'sticker',
                description: 'Convert image/video to sticker',
                usage: '.sticker (reply to media)',
                permissions: 'public',
                autoWrap: false,
                execute: this.createSticker.bind(this)
            },
            {
                name: 'toimg',
                description: 'Convert sticker to image',
                usage: '.toimg (reply to sticker)',
                permissions: 'public',
                autoWrap: false,
                execute: this.stickerToImage.bind(this)
            },
            {
                name: 'togif',
                description: 'Convert animated sticker to GIF',
                usage: '.togif (reply to animated sticker)',
                permissions: 'public',
                autoWrap: false,
                execute: this.stickerToGif.bind(this)
            },
            {
                name: 'textsticker',
                description: 'Create text sticker',
                usage: '.textsticker <text>',
                permissions: 'public',
                autoWrap: false,
                execute: this.textToSticker.bind(this)
            },
            {
                name: 'tovn',
                description: 'Convert audio to WhatsApp voice note',
                usage: '.tovn (reply to audio)',
                permissions: 'public',
                autoWrap: false,
                execute: this.audioToVoiceNote.bind(this)
            },
            {
                name: 'tomp3',
                description: 'Convert audio/video to MP3',
                usage: '.tomp3 (reply to media)',
                permissions: 'public',
                autoWrap: false,
                execute: this.toMp3.bind(this)
            },
            {
                name: 'tomp4',
                description: 'Convert video to MP4',
                usage: '.tomp4 (reply to video)',
                permissions: 'public',
                autoWrap: false,
                execute: this.toMp4.bind(this)
            },
            {
                name: 'togif2',
                description: 'Convert video to GIF',
                usage: '.togif2 (reply to video)',
                permissions: 'public',
                autoWrap: false,
                execute: this.videoToGif.bind(this)
            },
            {
                name: 'enhance',
                description: 'Enhance video quality',
                usage: '.enhance (reply to video)',
                permissions: 'public',
                autoWrap: false,
                execute: this.enhanceVideo.bind(this)
            },
            {
                name: 'denoise',
                description: 'Remove noise from audio',
                usage: '.denoise (reply to audio)',
                permissions: 'public',
                autoWrap: false,
                execute: this.denoiseAudio.bind(this)
            },
            {
                name: 'mutevideo',
                description: 'Remove audio from video',
                usage: '.mutevideo (reply to video)',
                permissions: 'public',
                autoWrap: false,
                execute: this.muteVideo.bind(this)
            },
            {
                name: 'compress',
                description: 'Compress video file',
                usage: '.compress (reply to video)',
                permissions: 'public',
                autoWrap: false,
                execute: this.compressVideo.bind(this)
            },
            
            // Currency Converter
            {
                name: 'currency',
                description: 'Convert currency',
                usage: '.currency <amount> <from> <to>',
                aliases: ['cur', 'exchange'],
                permissions: 'public',
                autoWrap: false,
                execute: this.convertCurrency.bind(this)
            },
            
            // Unified Unit Converter
            {
                name: 'unit',
                description: 'Convert units (length, weight, temp, area, volume)',
                usage: '.unit <value> <from_unit> to <to_unit>',
                permissions: 'public',
                autoWrap: false,
                execute: this.convertUnit.bind(this)
            }
        ];
    }

    async ensureTempDir() {
        await fs.ensureDir(this.tempDir);
    }

    // Media Converters
    async createSticker(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.imageMessage && !quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to an image or video to create a sticker.' });
        }

        try {
            const mediaType = quotedMsg.imageMessage ? 'image' : 'video';
            const mediaMessage = quotedMsg[`${mediaType}Message`];
            
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.${mediaType === 'image' ? 'jpg' : 'mp4'}`);
            const outputFile = path.join(this.tempDir, `sticker_${Date.now()}.webp`);

            await fs.writeFile(inputFile, buffer);

            if (mediaType === 'image') {
                await execAsync(`ffmpeg -i "${inputFile}" -vf "scale=512:512:force_original_aspect_ratio=increase,crop=512:512" -f webp "${outputFile}"`);
            } else {
                await execAsync(`ffmpeg -i "${inputFile}" -t 6 -vf "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15" -f webp -loop 0 "${outputFile}"`);
            }

            const stickerBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                sticker: stickerBuffer
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to create sticker: ${error.message}` });
        }
    }

    async stickerToImage(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.stickerMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to a sticker to convert it to image.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.stickerMessage, 'sticker');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `sticker_${Date.now()}.webp`);
            const outputFile = path.join(this.tempDir, `image_${Date.now()}.png`);

            await fs.writeFile(inputFile, buffer);
            await execAsync(`ffmpeg -i "${inputFile}" "${outputFile}"`);

            const imageBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                image: imageBuffer,
                caption: '🖼️ Sticker converted to image'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to convert sticker: ${error.message}` });
        }
    }

    async stickerToGif(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.stickerMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to an animated sticker to convert it to GIF.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.stickerMessage, 'sticker');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `sticker_${Date.now()}.webp`);
            const outputFile = path.join(this.tempDir, `gif_${Date.now()}.gif`);

            await fs.writeFile(inputFile, buffer);
            await execAsync(`ffmpeg -i "${inputFile}" -f gif "${outputFile}"`);

            const gifBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                video: gifBuffer,
                gifPlayback: true,
                caption: '🎭 Sticker converted to GIF'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to convert sticker to GIF: ${error.message}` });
        }
    }

    async textToSticker(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please provide text to create a sticker.\nUsage: .textsticker <text>' });
        }

        const text = params.join(' ');
        
        try {
            const outputFile = path.join(this.tempDir, `text_sticker_${Date.now()}.webp`);
            
            // Create text sticker using ImageMagick or similar
            await execAsync(`convert -size 512x512 xc:white -font Arial -pointsize 48 -fill black -gravity center -annotate +0+0 "${text}" "${outputFile}"`);

            const stickerBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                sticker: stickerBuffer
            });

            // Cleanup
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to create text sticker: ${error.message}` });
        }
    }

    async audioToVoiceNote(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.audioMessage && !quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to an audio or video file to convert to voice note.' });
        }

        try {
            const mediaType = quotedMsg.audioMessage ? 'audio' : 'video';
            const mediaMessage = quotedMsg[`${mediaType}Message`];
            
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.${mediaType === 'audio' ? 'mp3' : 'mp4'}`);
            const outputFile = path.join(this.tempDir, `voice_${Date.now()}.ogg`);

            await fs.writeFile(inputFile, buffer);
            await execAsync(`ffmpeg -i "${inputFile}" -c:a libopus -b:a 32k -vn "${outputFile}"`);

            const voiceBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                audio: voiceBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to convert to voice note: ${error.message}` });
        }
    }

    async toMp3(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.audioMessage && !quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to an audio or video file to convert to MP3.' });
        }

        try {
            const mediaType = quotedMsg.audioMessage ? 'audio' : 'video';
            const mediaMessage = quotedMsg[`${mediaType}Message`];
            
            const stream = await downloadContentFromMessage(mediaMessage, mediaType);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.${mediaType === 'audio' ? 'ogg' : 'mp4'}`);
            const outputFile = path.join(this.tempDir, `mp3_${Date.now()}.mp3`);

            await fs.writeFile(inputFile, buffer);
            await execAsync(`ffmpeg -i "${inputFile}" -c:a libmp3lame -q:a 2 "${outputFile}"`);

            const mp3Buffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                audio: mp3Buffer,
                mimetype: 'audio/mpeg'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to convert to MP3: ${error.message}` });
        }
    }

    async toMp4(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to a video file to convert to MP4.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.mp4`);
            const outputFile = path.join(this.tempDir, `mp4_${Date.now()}.mp4`);

            await fs.writeFile(inputFile, buffer);
            await execAsync(`ffmpeg -i "${inputFile}" -c copy "${outputFile}"`);

            const mp4Buffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                video: mp4Buffer,
                caption: '🎥 Converted to MP4'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to convert to MP4: ${error.message}` });
        }
    }

    async videoToGif(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to a video file to convert to GIF.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.mp4`);
            const outputFile = path.join(this.tempDir, `gif_${Date.now()}.gif`);

            await fs.writeFile(inputFile, buffer);
            await execAsync(`ffmpeg -i "${inputFile}" -vf "fps=10,scale=320:-1:flags=lanczos" -f gif "${outputFile}"`);

            const gifBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                video: gifBuffer,
                gifPlayback: true,
                caption: '🎭 Video converted to GIF'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to convert video to GIF: ${error.message}` });
        }
    }

    async enhanceVideo(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to a video file to enhance quality.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.mp4`);
            const outputFile = path.join(this.tempDir, `enhanced_${Date.now()}.mp4`);

            await fs.writeFile(inputFile, buffer);
            
            // Enhance video with upscaling and noise reduction
            await execAsync(`ffmpeg -i "${inputFile}" -vf "scale=iw*2:ih*2:flags=lanczos,unsharp=5:5:1.0:5:5:0.0" -c:v libx264 -crf 18 -preset slow "${outputFile}"`);

            const enhancedBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                video: enhancedBuffer,
                caption: '✨ Video quality enhanced'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to enhance video: ${error.message}` });
        }
    }

    async denoiseAudio(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.audioMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to an audio file to remove noise.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.audioMessage, 'audio');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.ogg`);
            const outputFile = path.join(this.tempDir, `denoised_${Date.now()}.mp3`);

            await fs.writeFile(inputFile, buffer);
            
            // Apply noise reduction filter
            await execAsync(`ffmpeg -i "${inputFile}" -af "highpass=f=200,lowpass=f=3000,afftdn" -c:a libmp3lame -b:a 128k "${outputFile}"`);

            const denoisedBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                audio: denoisedBuffer,
                mimetype: 'audio/mpeg',
                caption: '🔇 Noise removed from audio'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to denoise audio: ${error.message}` });
        }
    }

    async muteVideo(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to a video file to mute.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.mp4`);
            const outputFile = path.join(this.tempDir, `muted_${Date.now()}.mp4`);

            await fs.writeFile(inputFile, buffer);
            await execAsync(`ffmpeg -i "${inputFile}" -c:v copy -an "${outputFile}"`);

            const mutedBuffer = await fs.readFile(outputFile);

            await context.bot.sendMessage(context.sender, {
                video: mutedBuffer,
                caption: '🔇 Video muted (audio removed)'
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to mute video: ${error.message}` });
        }
    }

    async compressVideo(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.videoMessage) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to a video file to compress.' });
        }

        try {
            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const inputFile = path.join(this.tempDir, `input_${Date.now()}.mp4`);
            const outputFile = path.join(this.tempDir, `compressed_${Date.now()}.mp4`);

            await fs.writeFile(inputFile, buffer);
            
            // Compress video with higher CRF value
            await execAsync(`ffmpeg -i "${inputFile}" -c:v libx264 -crf 28 -preset fast -c:a aac -b:a 64k "${outputFile}"`);

            const compressedBuffer = await fs.readFile(outputFile);
            const originalSize = buffer.length;
            const compressedSize = compressedBuffer.length;
            const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

            await context.bot.sendMessage(context.sender, {
                video: compressedBuffer,
                caption: `📦 Video compressed\n💾 Size reduced by ${compressionRatio}%`
            });

            // Cleanup
            await fs.remove(inputFile);
            await fs.remove(outputFile);

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to compress video: ${error.message}` });
        }
    }

    // Currency Converter
    async convertCurrency(msg, params, context) {
        if (params.length < 3) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Usage: .currency <amount> <from> <to>\nExample: .currency 100 USD EUR' });
        }

        const amount = parseFloat(params[0]);
        const fromCurrency = params[1].toUpperCase();
        const toCurrency = params[2].toUpperCase();

        if (isNaN(amount)) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Invalid amount. Please provide a valid number.' });
        }

        try {
            await this.updateExchangeRates();
            
            if (!this.exchangeRates[fromCurrency] || !this.exchangeRates[toCurrency]) {
                return await context.bot.sendMessage(context.sender, { text: '❌ Invalid currency code. Please use valid 3-letter currency codes (e.g., USD, EUR, GBP).' });
            }

            const fromRate = this.exchangeRates[fromCurrency];
            const toRate = this.exchangeRates[toCurrency];
            const convertedAmount = (amount / fromRate) * toRate;

            await context.bot.sendMessage(context.sender, { text: 
                `💱 **Currency Conversion**\n\n` +
                `${amount} ${fromCurrency} = ${convertedAmount.toFixed(2)} ${toCurrency}\n\n` +
                `📊 Exchange Rate: 1 ${fromCurrency} = ${(toRate / fromRate).toFixed(4)} ${toCurrency}\n` +
                `⏰ Updated: ${new Date(this.ratesLastUpdated).toLocaleString()}`
            });

        } catch (error) {
            await context.bot.sendMessage(context.sender, { text: `❌ Failed to convert currency: ${error.message}` });
        }
    }

    async updateExchangeRates() {
        const now = Date.now();
        if (this.exchangeRates && (now - this.ratesLastUpdated) < this.ratesCacheTime) {
            return; // Use cached rates
        }

        try {
            const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
            this.exchangeRates = { USD: 1, ...response.data.rates };
            this.ratesLastUpdated = now;
        } catch (error) {
            throw new Error('Failed to fetch exchange rates');
        }
    }

    // Unified Unit Converter
    async convertUnit(msg, params, context) {
        if (params.length < 4 || params[2].toLowerCase() !== 'to') {
            return await context.bot.sendMessage(context.sender, { text: 
                '❌ Usage: .unit <value> <from_unit> to <to_unit>\n' +
                'Example: .unit 10 feet to inches\n\n' +
                'Supported categories: length (mm, cm, m, km, in, ft, yd, mi), ' +
                'weight (mg, g, kg, oz, lb, ton), ' +
                'temperature (c, f, k), ' +
                'area (mm2, cm2, m2, km2, in2, ft2, yd2, acre), ' +
                'volume (ml, l, gal, qt, pt, cup, fl_oz)'
            });
        }

        const value = parseFloat(params[0]);
        let fromUnit = params[1].toLowerCase();
        let toUnit = params[3].toLowerCase();

        if (isNaN(value)) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Invalid value. Please provide a valid number.' });
        }

        // Find category
        let category = null;
        for (const cat in this.units) {
            if (this.units[cat][fromUnit] && this.units[cat][toUnit]) {
                category = cat;
                break;
            }
        }

        if (!category) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Invalid or mismatched units. Use units from the same category.' });
        }

        let result;
        let symbol = '';

        if (category === 'temperature') {
            let celsius;
            switch (fromUnit) {
                case 'c':
                    celsius = value;
                    break;
                case 'f':
                    celsius = (value - 32) * 5/9;
                    break;
                case 'k':
                    celsius = value - 273.15;
                    break;
            }

            switch (toUnit) {
                case 'c':
                    result = celsius;
                    break;
                case 'f':
                    result = celsius * 9/5 + 32;
                    break;
                case 'k':
                    result = celsius + 273.15;
                    break;
            }
            result = result.toFixed(2);
            symbol = '°';
            fromUnit = fromUnit.toUpperCase();
            toUnit = toUnit.toUpperCase();

            await context.bot.sendMessage(context.sender, { text: 
                `🌡️ **Temperature Conversion**\n\n${value}${symbol}${fromUnit} = ${result}${symbol}${toUnit}`
            });
        } else {
            const base = value * this.units[category][fromUnit];
            result = base / this.units[category][toUnit];
            result = result.toFixed(6);

            let emoji = '';
            let title = '';
            switch (category) {
                case 'length':
                    emoji = '📏';
                    title = 'Length';
                    break;
                case 'weight':
                    emoji = '⚖️';
                    title = 'Weight';
                    break;
                case 'area':
                    emoji = '📐';
                    title = 'Area';
                    break;
                case 'volume':
                    emoji = '🥤';
                    title = 'Volume';
                    break;
            }

            await context.bot.sendMessage(context.sender, { text: 
                `${emoji} **${title} Conversion**\n\n${value} ${fromUnit} = ${result} ${toUnit}`
            });
        }
    }
}

module.exports = ConverterModule;
