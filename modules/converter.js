const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const execAsync = promisify(exec);

class ConverterModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'converter';
        this.metadata = {
            description: 'Advanced media and unit converter with audio/video processing',
            version: '2.0.2',
            author: 'HyperWa Team',
            category: 'utility'
        };

        this.tempDir = path.join(__dirname, '../temp');
        this.ensureTempDir();

        // Exchange rates cache
        this.exchangeRates = null;
        this.ratesLastUpdated = 0;
        this.ratesCacheTime = 3600000; // 1 hour

        this.commands = [
            // Media Converters
            {
                name: 'sticker',
                description: 'Convert image/video/text to sticker',
                usage: '.sticker (reply to media or provide text)',
                aliases: ['s'],
                permissions: 'public',
                execute: this.createStickerAuto.bind(this)
            },
            {
                name: 'toimg',
                description: 'Convert sticker to image',
                usage: '.toimg (reply to sticker)',
                permissions: 'public',
                execute: this.stickerToImage.bind(this)
            },
            {
                name: 'togif',
                description: 'Convert animated sticker to GIF',
                usage: '.togif (reply to animated sticker)',
                permissions: 'public',
                execute: this.stickerToGif.bind(this)
            },
            {
                name: 'tovn',
                description: 'Convert audio to WhatsApp voice note',
                usage: '.tovn (reply to audio)',
                permissions: 'public',
                execute: this.audioToVoiceNote.bind(this)
            },
            {
                name: 'tomp3',
                description: 'Convert audio/video to MP3',
                usage: '.tomp3 (reply to media)',
                permissions: 'public',
                execute: this.toMp3.bind(this)
            },
            {
                name: 'tomp4',
                description: 'Convert video to MP4',
                usage: '.tomp4 (reply to video)',
                permissions: 'public',
                execute: this.toMp4.bind(this)
            },
            {
                name: 'togif2',
                description: 'Convert video to GIF',
                usage: '.togif2 (reply to video)',
                permissions: 'public',
                execute: this.videoToGif.bind(this)
            },
            {
                name: 'enhance',
                description: 'Enhance video quality',
                usage: '.enhance (reply to video)',
                permissions: 'public',
                execute: this.enhanceVideo.bind(this)
            },
            {
                name: 'denoise',
                description: 'Remove noise from audio',
                usage: '.denoise (reply to audio)',
                permissions: 'public',
                execute: this.denoiseAudio.bind(this)
            },
            {
                name: 'mutevideo',
                description: 'Remove audio from video',
                usage: '.mutevideo (reply to video)',
                permissions: 'public',
                execute: this.muteVideo.bind(this)
            },
            {
                name: 'compress',
                description: 'Compress video file',
                usage: '.compress (reply to video)',
                permissions: 'public',
                execute: this.compressVideo.bind(this)
            },
            // Currency Converter
            {
                name: 'currency',
                description: 'Convert currency',
                usage: '.currency <amount> <from> <to>',
                aliases: ['cur', 'exchange'],
                permissions: 'public',
                execute: this.convertCurrency.bind(this)
            }
        ];
    }

    async ensureTempDir() {
        try {
            await fs.ensureDir(this.tempDir);
            // Verify write permissions
            const testFile = path.join(this.tempDir, 'test.txt');
            await fs.writeFile(testFile, 'test');
            await fs.remove(testFile);
        } catch (error) {
            console.error(`Failed to ensure temp directory: ${error.message}`);
            throw new Error('Cannot create or write to temporary directory');
        }
    }

    // Media Converters
 // Fixed video sticker processing method - Simple approach
async createStickerAuto(msg, params, context) {
    try {
        let mediaBuffer;
        let mediaType;
        let isTextSticker = false;
        let stickerOptions = {
            pack: 'HyperWa Stickers',
            author: 'HyperWa Bot',
            categories: ['🤖', '💬'],
            id: `hyperwa-${Date.now()}`,
            quality: 50,
            type: StickerTypes.DEFAULT
        };

        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        // --- CASE 1: Text Sticker ---
        if (!quotedMsg && params.length > 0) {
            const text = params.join(' ');
            if (text.length > 100) {
                return await context.bot.sendMessage(context.sender, { text: '❌ Text is too long. Please use up to 100 characters.' });
            }
            mediaBuffer = await this.createTextImage(text);
            stickerOptions.pack = 'HyperWa Text Stickers';
            stickerOptions.categories = ['📝', '💬'];
            isTextSticker = true;
        }

        // --- CASE 2: Media Sticker ---
        if (!isTextSticker) {
            if (!quotedMsg) {
                return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to an image or video to create a sticker.' });
            }

            // Video/GIF case
            if (quotedMsg.videoMessage) {
                const videoMessage = quotedMsg.videoMessage;
                
                // Validate video duration
                if (videoMessage.seconds && videoMessage.seconds > 6) {
                    return await context.bot.sendMessage(context.sender, { text: '❌ Video is too long. Please use a video of 6 seconds or less.' });
                }

                // Validate video file size (max 10MB)
                if (videoMessage.fileLength && videoMessage.fileLength > 10 * 1024 * 1024) {
                    return await context.bot.sendMessage(context.sender, { text: '❌ Video file is too large. Please use a video smaller than 10MB.' });
                }

                // Send processing message
                await context.bot.sendMessage(context.sender, { text: '⏳ Converting video to sticker...' });

                stickerOptions.pack = 'HyperWa Animated';
                stickerOptions.categories = ['🎬', '🎭'];
                stickerOptions.type = StickerTypes.FULL;
                stickerOptions.quality = 30;

                try {
                    // Download video
                    const stream = await downloadContentFromMessage(videoMessage, 'video');
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    const videoBuffer = Buffer.concat(chunks);

                    // Additional size check after download
                    if (videoBuffer.length > 10 * 1024 * 1024) {
                        return await context.bot.sendMessage(context.sender, { text: '❌ Video file is too large. Please use a smaller video.' });
                    }

                    // Process video: video → gif → webp sticker
                    mediaBuffer = await this.processVideoToSticker(videoBuffer);

                } catch (error) {
                    console.error(`Video sticker processing failed: ${error.message}`);
                    return await context.bot.sendMessage(context.sender, { text: '❌ Failed to process video sticker. Please try with a different video.' });
                }
                mediaType = 'video';
            }
            // Image case
            else if (quotedMsg.imageMessage) {
                const imageMessage = quotedMsg.imageMessage;
                
                // Validate image file size (max 5MB)
                if (imageMessage.fileLength && imageMessage.fileLength > 5 * 1024 * 1024) {
                    return await context.bot.sendMessage(context.sender, { text: '❌ Image file is too large. Please use an image smaller than 5MB.' });
                }

                const stream = await downloadContentFromMessage(imageMessage, 'image');
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                mediaBuffer = Buffer.concat(chunks);

                // Additional size check after download
                if (mediaBuffer.length > 5 * 1024 * 1024) {
                    return await context.bot.sendMessage(context.sender, { text: '❌ Image file is too large. Please use a smaller image.' });
                }

                mediaType = 'image';
            } else {
                return await context.bot.sendMessage(context.sender, { text: '❌ Please reply to a valid image or video.' });
            }
        }

        if (!mediaBuffer) {
            return await context.bot.sendMessage(context.sender, { text: '❌ No valid media or text provided for sticker creation.' });
        }

        // --- CREATE & SEND STICKER ---
        const sticker = new Sticker(mediaBuffer, stickerOptions);
        const stickerBuffer = await sticker.toBuffer();

        // Verify sticker buffer is valid
        if (!stickerBuffer || stickerBuffer.length === 0) {
            throw new Error('Generated sticker buffer is empty or invalid');
        }

        // Final size check - if still too large, reject
        if (stickerBuffer.length > 1000000) {
            return await context.bot.sendMessage(context.sender, { text: '❌ Generated sticker is too large. Please use a shorter video or smaller image.' });
        }

        await context.bot.sendMessage(context.sender, { sticker: stickerBuffer });

    } catch (error) {
        console.error(`Sticker creation failed: ${error.message}`);
        await context.bot.sendMessage(context.sender, { text: `❌ Failed to create sticker: ${error.message}` });
    }
}

// Simple video to sticker conversion: video → gif → webp
async processVideoToSticker(videoBuffer) {
    const inputFile = path.join(this.tempDir, `input_${Date.now()}.mp4`);
    const gifFile = path.join(this.tempDir, `gif_${Date.now()}.gif`);
    const outputFile = path.join(this.tempDir, `sticker_${Date.now()}.webp`);

    try {
        // Save video to temp file
        await fs.writeFile(inputFile, videoBuffer);

        // Step 1: Convert video to GIF with timeout
        await execAsync(
            `ffmpeg -y -i "${inputFile}" -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2" -an -f gif "${gifFile}"`,
            { timeout: 20000 }
        );

        // Check if GIF was created
        if (!await fs.pathExists(gifFile)) {
            throw new Error('Failed to create GIF from video');
        }

        // Step 2: Convert GIF to WebP sticker with timeout  
        await execAsync(
            `ffmpeg -y -i "${gifFile}" -c:v libwebp -vf "fps=15,scale=512:512" -loop 0 -an -vsync 0 "${outputFile}"`,
            { timeout: 15000 }
        );

        // Check if WebP was created
        if (!await fs.pathExists(outputFile)) {
            throw new Error('Failed to create WebP sticker from GIF');
        }

        // Check output file size
        const stats = await fs.stat(outputFile);
        if (stats.size === 0) {
            throw new Error('Output sticker file is empty');
        }

        // If WebP is too large (>800KB), reject it
        if (stats.size > 800000) {
            throw new Error('Generated sticker is too large. Please use a shorter video.');
        }

        const stickerBuffer = await fs.readFile(outputFile);
        return stickerBuffer;

    } catch (error) {
        console.error(`Video to sticker conversion failed: ${error.message}`);
        throw new Error(`Conversion failed: ${error.message}`);
    } finally {
        // Always cleanup temp files
        try {
            await fs.remove(inputFile).catch(() => {});
            await fs.remove(gifFile).catch(() => {});
            await fs.remove(outputFile).catch(() => {});
        } catch (cleanupError) {
            console.warn(`Cleanup failed: ${cleanupError.message}`);
        }
    }
}
    // --- TEXT IMAGE GENERATOR ---
    async createTextImage(text) {
        try {
            const sharp = require('sharp');
            
            const svg = `
                <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
                    <rect width="512" height="512" fill="#ffffff"/>
                    <text x="256" y="256" font-family="Arial, sans-serif" font-size="40"
                          text-anchor="middle" dominant-baseline="middle" fill="#000000">
                        ${text}
                    </text>
                </svg>
            `;
            
            return await sharp(Buffer.from(svg)).png().toBuffer();
            
        } catch (error) {
            console.warn('Sharp not available, using placeholder for text sticker');
            throw new Error('Text sticker creation requires image processing library (sharp)');
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
}

module.exports = ConverterModule;
