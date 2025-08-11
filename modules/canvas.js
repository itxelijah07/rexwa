const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('fs-extra');
const path = require('path');

class CanvasModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'canvas';
        this.metadata = {
            description: 'Create images, memes, and graphics using canvas',
            version: '1.1.0',
            author: 'HyperWa Team',
            category: 'media'
        };
        
        this.commands = [
            {
                name: 'cmeme',
                description: 'Create a meme with top and bottom text',
                usage: '.meme <top_text> | <bottom_text> (reply to image)',
                permissions: 'public',
                execute: this.createMeme.bind(this)
            },
            {
                name: 'cquote',
                description: 'Create a quote image',
                usage: '.quote <text> - <author>',
                permissions: 'public',
                execute: this.createQuote.bind(this)
            },
            {
                name: 'banner',
                description: 'Create a text banner',
                usage: '.banner <text>',
                permissions: 'public',
                execute: this.createBanner.bind(this)
            },
            {
                name: 'profile',
                description: 'Create profile card',
                usage: '.profile <name> <status> (reply to profile pic)',
                permissions: 'public',
                execute: this.createProfile.bind(this)
            },
            {
                name: 'welcome',
                description: 'Create welcome image',
                usage: '.welcome <name> (reply to profile pic)',
                permissions: 'public',
                execute: this.createWelcome.bind(this)
            },
            {
                name: 'achievement',
                description: 'Create achievement badge',
                usage: '.achievement <title> <description>',
                permissions: 'public',
                execute: this.createAchievement.bind(this)
            },
            {
                name: 'gradient',
                description: 'Create gradient background',
                usage: '.gradient <color1> <color2> [direction]',
                permissions: 'public',
                execute: this.createGradient.bind(this)
            },
            {
                name: 'textimage',
                description: 'Create image with text and customizable background',
                usage: '.textimage <text> [color1] [color2] [font]',
                permissions: 'public',
                execute: this.createTextImage.bind(this)
            },
            {
                name: 'discount',
                description: 'Create discount offer image',
                usage: '.discount <percentage> <text> [color1] [color2]',
                permissions: 'public',
                execute: this.createDiscount.bind(this)
            }
        ];
        
        this.tempDir = path.join(__dirname, '../temp');
    }

    async createMeme(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg?.imageMessage) {
            return '❌ *Meme Creation*\n\nPlease reply to an image to create a meme.\n\n💡 Usage: Reply to image and type `.meme <top_text> | <bottom_text>`\n📝 Example: `.meme When you code | But it works`';
        }

        if (params.length === 0) {
            return '❌ *Missing Text*\n\nPlease provide meme text.\n\n💡 Format: `.meme <top_text> | <bottom_text>`';
        }

        const text = params.join(' ');
        const parts = text.split('|').map(part => part.trim());
        const topText = parts[0] || '';
        const bottomText = parts[1] || '';

        try {
            const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const imageBuffer = Buffer.concat(chunks);

            const image = await loadImage(imageBuffer);
            const canvas = createCanvas(image.width, image.height);
            const ctx = canvas.getContext('2d');

            ctx.drawImage(image, 0, 0);

            const fontSize = Math.max(20, image.width / 15);
            ctx.font = `bold ${fontSize}px Impact`;
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = fontSize / 15;
            ctx.textAlign = 'center';

            if (topText) {
                const lines = this.wrapText(ctx, topText.toUpperCase(), image.width - 20);
                lines.forEach((line, index) => {
                    const y = 50 + (index * fontSize * 1.2);
                    ctx.strokeText(line, image.width / 2, y);
                    ctx.fillText(line, image.width / 2, y);
                });
            }

            if (bottomText) {
                const lines = this.wrapText(ctx, bottomText.toUpperCase(), image.width - 20);
                lines.forEach((line, index) => {
                    const y = image.height - 30 - ((lines.length - 1 - index) * fontSize * 1.2);
                    ctx.strokeText(line, image.width / 2, y);
                    ctx.fillText(line, image.width / 2, y);
                });
            }

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `🎭 *Meme Created*\n\n📝 Top: "${topText}"\n📝 Bottom: "${bottomText}"\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Meme Creation Failed*: ${error.message}`;
        }
    }

    async createQuote(msg, params, context) {
        if (params.length === 0) {
            return '❌ *Quote Creation*\n\nPlease provide quote text.\n\n💡 Usage: `.quote <text> - <author>`\n📝 Example: `.quote Life is beautiful - Unknown`';
        }

        const input = params.join(' ');
        const parts = input.split(' - ');
        const quote = parts[0].trim();
        const author = parts[1]?.trim() || 'Anonymous';

        try {
            const canvas = createCanvas(800, 600);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 800, 600);
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(1, '#764ba2');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 800, 600);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.font = 'bold 200px serif';
            ctx.textAlign = 'center';
            ctx.fillText('"', 150, 200);
            ctx.fillText('"', 650, 500);

            ctx.fillStyle = 'white';
            ctx.font = 'italic 36px Georgia';
            ctx.textAlign = 'center';
            
            const quoteLines = this.wrapText(ctx, quote, 700);
            const startY = 300 - (quoteLines.length * 25);
            
            quoteLines.forEach((line, index) => {
                ctx.fillText(line, 400, startY + (index * 50));
            });

            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(`— ${author}`, 400, startY + (quoteLines.length * 50) + 60);

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `💭 *Quote Created*\n\n📝 "${quote}"\n👤 — ${author}\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Quote Creation Failed*: ${error.message}`;
        }
    }

    async createBanner(msg, params, context) {
        if (params.length === 0) {
            return '❌ *Banner Creation*\n\nPlease provide banner text.\n\n💡 Usage: `.banner <text>`\n📝 Example: `.banner Welcome to our server!`';
        }

        const text = params.join(' ');

        try {
            const canvas = createCanvas(1200, 300);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 1200, 300);
            gradient.addColorStop(0, '#ff6b6b');
            gradient.addColorStop(0.5, '#4ecdc4');
            gradient.addColorStop(1, '#45b7d1');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 1200, 300);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            for (let i = 0; i < 20; i++) {
                const x = Math.random() * 1200;
                const y = Math.random() * 300;
                const size = Math.random() * 10 + 5;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 3;
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const lines = this.wrapText(ctx, text, 1100);
            const startY = 150 - ((lines.length - 1) * 30);

            lines.forEach((line, index) => {
                const y = startY + (index * 60);
                ctx.strokeText(line, 600, y);
                ctx.fillText(line, 600, y);
            });

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `🎨 *Banner Created*\n\n📝 Sony Text: "${text}"\n📏 Size: 1200x300\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Banner Creation Failed*: ${error.message}`;
        }
    }

    async createProfile(msg, params, context) {
        if (params.length < 2) {
            return '❌ *Profile Card*\n\nPlease provide name and status.\n\n💡 Usage: `.profile <name> <status>` (reply to profile pic)\n📝 Example: `.profile John Doe Online`';
        }

        const name = params[0];
        const status = params.slice(1).join(' ');
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        try {
            const canvas = createCanvas(600, 200);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 600, 200);
            gradient.addColorStop(0, '#2c3e50');
            gradient.addColorStop(1, '#34495e');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 600, 200);

            let profileImage = null;
            if (quotedMsg?.imageMessage) {
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                const imageBuffer = Buffer.concat(chunks);
                profileImage = await loadImage(imageBuffer);
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(100, 100, 60, 0, Math.PI * 2);
            ctx.clip();

            if (profileImage) {
                ctx.drawImage(profileImage, 40, 40, 120, 120);
            } else {
                ctx.fillStyle = '#95a5a6';
                ctx.fillRect(40, 40, 120, 120);
                ctx.fillStyle = 'white';
                ctx.font = 'bold 48px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(name.charAt(0).toUpperCase(), 100, 115);
            }
            ctx.restore();

            ctx.fillStyle = 'white';
            ctx.font = 'bold 32px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(name, 180, 80);

            ctx.font = '20px Arial';
            ctx.fillStyle = '#bdc3c7';
            ctx.fillText(status, 180, 110);

            ctx.fillStyle = status.toLowerCase().includes('online') ? '#2ecc71' : '#e74c3c';
            ctx.beginPath();
            ctx.arc(550, 50, 8, 0, Math.PI * 2);
            ctx.fill();

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `👤 *Profile Card Created*\n\n👤 Name: ${name}\n📊 Status: ${status}\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Profile Creation Failed*: ${error.message}`;
        }
    }

    async createWelcome(msg, params, context) {
        if (params.length === 0) {
            return '❌ *Welcome Image*\n\nPlease provide a name.\n\n💡 Usage: `.welcome <name>` (reply to profile pic)\n📝 Example: `.welcome John Doe`';
        }

        const name = params.join(' ');
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        try {
            const canvas = createCanvas(800, 400);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(400, 200, 0, 400, 200, 400);
            gradient.addColorStop(0, '#ff9a9e');
            gradient.addColorStop(1, '#fecfef');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 800, 400);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            for (let i = 0; i < 30; i++) {
                const x = Math.random() * 800;
                const y = Math.random() * 400;
                const size = Math.random() * 5 + 2;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }

            let profileImage = null;
            if (quotedMsg?.imageMessage) {
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                const imageBuffer = Buffer.concat(chunks);
                profileImage = await loadImage(imageBuffer);
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(400, 150, 80, 0, Math.PI * 2);
            ctx.clip();

            if (profileImage) {
                ctx.drawImage(profileImage, 320, 70, 160, 160);
            } else {
                ctx.fillStyle = 'white';
                ctx.fillRect(320, 70, 160, 160);
                ctx.fillStyle = '#333';
                ctx.font = 'bold 64px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(name.charAt(0).toUpperCase(), 400, 170);
            }
            ctx.restore();

            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 2;
            ctx.font = 'bold 48px Arial';
            ctx.textAlign = 'center';
            ctx.strokeText('WELCOME', 400, 280);
            ctx.fillText('WELCOME', 400, 280);

            ctx.font = 'bold 32px Arial';
            ctx.strokeText(name, 400, 320);
            ctx.fillText(name, 400, 320);

            ctx.font = '20px Arial';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillText('We\'re glad to have you here!', 400, 350);

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `🎉 *Welcome Image Created*\n\n👋 Welcome ${name}!\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Welcome Image Failed*: ${error.message}`;
        }
    }

    async createAchievement(msg, params, context) {
        if (params.length < 2) {
            return '❌ *Achievement Badge*\n\nPlease provide title and description.\n\n💡 Usage: `.achievement <title> <description>`\n📝 Example: `.achievement First Message Sent your first message!`';
        }

        const title = params[0];
        const description = params.slice(1).join(' ');

        try {
            const canvas = createCanvas(600, 200);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 600, 200);
            gradient.addColorStop(0, '#f39c12');
            gradient.addColorStop(1, '#e67e22');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 600, 200);

            ctx.strokeStyle = '#d35400';
            ctx.lineWidth = 4;
            ctx.strokeRect(10, 10, 580, 180);

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 64px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('🏆', 100, 120);

            ctx.fillStyle = 'white';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'left';
            ctx.fillText('Achievement Unlocked!', 150, 60);

            ctx.font = 'bold 24px Arial';
            ctx.fillText(title, 150, 100);

            ctx.font = '18px Arial';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            const descLines = this.wrapText(ctx, description, 400);
            descLines.forEach((line, index) => {
                ctx.fillText(line, 150, 130 + (index * 22));
            });

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `🏆 *Achievement Created*\n\n🎯 Title: ${title}\n📝 Description: ${description}\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Achievement Creation Failed*: ${error.message}`;
        }
    }

    async createGradient(msg, params, context) {
        if (params.length < 2) {
            return '❌ *Gradient Creation*\n\nPlease provide two colors.\n\n💡 Usage: `.gradient <color1> <color2> [direction]`\n📝 Example: `.gradient #ff0000 #0000ff horizontal`';
        }

        const color1 = params[0];
        const color2 = params[1];
        const direction = params[2]?.toLowerCase() || 'horizontal';

        try {
            const canvas = createCanvas(800, 600);
            const ctx = canvas.getContext('2d');

            let gradient;
            switch (direction) {
                case 'vertical':
                    gradient = ctx.createLinearGradient(0, 0, 0, 600);
                    break;
                case 'diagonal':
                    gradient = ctx.createLinearGradient(0, 0, 800, 600);
                    break;
                case 'radial':
                    gradient = ctx.createRadialGradient(400, 300, 0, 400, 300, 400);
                    break;
                default:
                    gradient = ctx.createLinearGradient(0, 0, 800, 0);
            }

            gradient.addColorStop(0, color1);
            gradient.addColorStop(1, color2);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 800, 600);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${color1} → ${color2}`, 400, 50);
            ctx.font = '18px Arial';
            ctx.fillText(`Direction: ${direction}`, 400, 80);

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `🌈 *Gradient Created*\n\n🎨 Colors: ${color1} → ${color2}\n📐 Direction: ${direction}\n📏 Size: 800x600\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Gradient Creation Failed*: ${error.message}`;
        }
    }

    async createTextImage(msg, params, context) {
        if (params.length === 0) {
            return '❌ *Text Image Creation*\n\nPlease provide text.\n\n💡 Usage: `.textimage <text> [color1] [color2] [font]`\n📝 Example: `.textimage Hello World #ff0000 #0000ff Arial`';
        }

        const text = params[0];
        const color1 = params[1] || '#4b6cb7';
        const color2 = params[2] || '#182848';
        const font = params[3] || 'Arial';

        try {
            const canvas = createCanvas(800, 400);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 800, 400);
            gradient.addColorStop(0, color1);
            gradient.addColorStop(1, color2);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 800, 400);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            for (let i = 0; i < 20; i++) {
                const x = Math.random() * 800;
                const y = Math.random() * 400;
                const size = Math.random() * 5 + 2;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.lineWidth = 3;
            ctx.font = `bold 48px ${font}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const lines = this.wrapText(ctx, text, 700);
            const startY = 200 - ((lines.length - 1) * 30);

            lines.forEach((line, index) => {
                const y = startY + (index * 60);
                ctx.strokeText(line, 400, y);
                ctx.fillText(line, 400, y);
            });

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `🖼️ *Text Image Created*\n\n📝 Text: "${text}"\n🎨 Colors: ${color1} → ${color2}\n🖌️ Font: ${font}\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Text Image Creation Failed*: ${error.message}`;
        }
    }

    async createDiscount(msg, params, context) {
        if (params.length < 2) {
            return '❌ *Discount Image*\n\nPlease provide percentage and text.\n\n💡 Usage: `.discount <percentage> <text> [color1] [color2]`\n📝 Example: `.discount 20% Limited Time Offer #ff0000 #0000ff`';
        }

        const percentage = params[0];
        const text = params.slice(1).join(' ');
        const color1 = params[params.length - 2]?.startsWith('#') ? params[params.length - 2] : '#e91e63';
        const color2 = params[params.length - 1]?.startsWith('#') ? params[params.length - 1] : '#ad1457';

        try {
            const canvas = createCanvas(800, 400);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(400, 200, 0, 400, 200, 400);
            gradient.addColorStop(0, color1);
            gradient.addColorStop(1, color2);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 800, 400);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            for (let i = 0; i < 30; i++) {
                const x = Math.random() * 800;
                const y = Math.random() * 400;
                const size = Math.random() * 8 + 4;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 4;
            ctx.font = 'bold 72px Arial';
            ctx.textAlign = 'center';
            ctx.strokeText(`${percentage} OFF`, 400, 150);
            ctx.fillText(`${percentage} OFF`, 400, 150);

            ctx.font = 'bold 36px Arial';
            const lines = this.wrapText(ctx, text, 700);
            const startY = 220 - ((lines.length - 1) * 20);

            lines.forEach((line, index) => {
                ctx.strokeText(line, 400, startY + (index * 50));
                ctx.fillText(line, 400, startY + (index * 50));
            });

            ctx.font = '24px Arial';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillText('Hurry! Limited Time Offer', 400, 350);

            const buffer = canvas.toBuffer('image/png');

            await context.bot.sendMessage(context.sender, {
                image: buffer,
                caption: `💸 *Discount Image Created*\n\n🎯 ${percentage} OFF\n📝 ${text}\n🎨 Colors: ${color1} → ${color2}\n⏰ ${new Date().toLocaleTimeString()}`
            });

        } catch (error) {
            return `❌ *Discount Image Creation Failed*: ${error.message}`;
        }
    }

    wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + ' ' + word).width;
            if (width < maxWidth) {
                currentLine += ' ' + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    }
}

module.exports = CanvasModule;
