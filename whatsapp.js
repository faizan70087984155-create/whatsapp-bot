const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { autoReplyBrain } = require('./aiBrain');
const EventEmitter = require('events');

class WhatsAppService extends EventEmitter {
    constructor() {
        super();
        this.status = 'DISCONNECTED';
        this.qrCodeDataUrl = null;
        this.initializeClient();
    }

    async initializeClient() {
        let authStrategy = new LocalAuth({ dataPath: './.wwebjs_auth' });

        const puppeteerConfig = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        };

        const defaultWinPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
        
        if (chromePath) {
            puppeteerConfig.executablePath = chromePath;
        } else if (process.platform === 'win32') {
            puppeteerConfig.executablePath = defaultWinPath;
        } else {
            puppeteerConfig.executablePath = '/usr/bin/google-chrome-stable';
        }

        this.client = new Client({
            authStrategy: authStrategy,
            puppeteer: puppeteerConfig
        });

        this.client.on('qr', async (qr) => {
            console.log('QR RECEIVED - Scan this with your WhatsApp:');
            qrcodeTerminal.generate(qr, { small: true });
            this.status = 'AWAITING_SCAN';
            try {
                this.qrCodeDataUrl = await qrcode.toDataURL(qr);
                this.emit('status_change', { status: this.status, qr: this.qrCodeDataUrl });
            } catch (err) {
                console.error('Error generating QR code:', err);
            }
        });

        this.client.on('ready', () => {
            console.log('Client is ready!');
            this.status = 'CONNECTED';
            this.qrCodeDataUrl = null;
            this.emit('status_change', { status: this.status });
            
            // Periodic Presence Anti-Ban (Broadcasts "Online" randomly every 1-5 minutes to look active)
            setInterval(async () => {
                if (this.status === 'CONNECTED') {
                    try {
                        await this.client.sendPresenceAvailable();
                    } catch(e) {}
                }
            }, Math.floor(Math.random() * (300000 - 60000 + 1)) + 60000);
        });

        this.client.on('message', async (msg) => {
            // Ignore status broadcasts, group messages, and empty messages
            const chat = await msg.getChat();
            if (msg.isStatus || chat.isGroup) return;
            if (!msg.body || msg.body.trim() === '') {
                console.log(`[DEBUG WA] Ignored empty message from ${msg.from} (Media/System)`);
                return;
            }

            // Anti-Ban: Read Receipt Delay (Simulate human looking at phone)
            const readDelay = Math.floor(Math.random() * (8000 - 3000 + 1)) + 3000;
            setTimeout(async () => {
                try { await chat.sendSeen(); } catch(e) {}
            }, readDelay);

            const contact = await msg.getContact();
            const nameToUse = contact.name || contact.pushname || 'Unknown';
            
            // For Meta Business LIDs, the real phone number is usually in contact.id.user
            let realPhone = msg.from.split('@')[0];
            if (contact.id && contact.id.user) {
                realPhone = contact.id.user;
            }
            
            console.log(`[DEBUG WA] Received msg! from=${msg.from}, author=${msg.author}, number=${contact.number}, pushname=${contact.pushname}, id=${JSON.stringify(contact.id)}, resolvedPhone=${realPhone}`);
            
            this.emit('reply_received', {
                name: nameToUse,
                phone: realPhone,
                message: msg.body
            });

            // Trigger the AI Brain to analyze and auto-respond
            autoReplyBrain(this, realPhone, msg.body, nameToUse, msg.from);
        });

        this.client.on('authenticated', () => {
            console.log('AUTHENTICATED');
            this.status = 'AUTHENTICATED';
            this.emit('status_change', { status: this.status });
        });

        this.client.on('auth_failure', msg => {
            console.error('AUTHENTICATION FAILURE', msg);
            this.status = 'AUTH_FAILURE';
            this.emit('status_change', { status: this.status });
        });

        this.client.on('disconnected', (reason) => {
            console.log('Client was logged out', reason);
            this.status = 'DISCONNECTED';
            this.qrCodeDataUrl = null;
            this.emit('status_change', { status: this.status });
        });

        this.client.initialize();
    }

    async getStatus() {
        return {
            status: this.status,
            qr: this.qrCodeDataUrl
        };
    }

    async logout() {
        if (this.status === 'CONNECTED') {
            await this.client.logout();
        }
        // Force restart if not fully connected
        if(this.status !== 'CONNECTED' && this.status !== 'DISCONNECTED') {
            await this.client.destroy();
            this.status = 'DISCONNECTED';
            this.qrCodeDataUrl = null;
            this.initializeClient();
        }
    }

    // Helper for simulating typing
    async simulateTyping(chatId) {
        const chat = await this.client.getChatById(chatId);
        await chat.sendStateTyping();
    }

    async clearTyping(chatId) {
        const chat = await this.client.getChatById(chatId);
        await chat.clearState();
    }

    async extractContacts() {
        if (this.status !== 'CONNECTED') {
            throw new Error('WhatsApp is not connected.');
        }
        
        // Use getChats() instead of getContacts() to only pull people you actually have chat history with.
        // WhatsApp perfectly loads pushnames for active chats.
        const chats = await this.client.getChats();
        const extracted = [];

        for (const chat of chats) {
            if (!chat.isGroup) {
                const contact = await chat.getContact();
                
                // Only extract standard phone number contacts. Skip 'lid' (Linked Devices) or unknown formats.
                if (!contact.id || contact.id.server !== 'c.us') {
                    continue;
                }
                
                // Try phonebook name, then public profile name, then the chat title
                let nameToUse = contact.name || contact.pushname || chat.name;

                // If the best name we found is literally just their phone number, use the Smart Fallback
                if (!nameToUse || /^[+\d\s-]+$/.test(nameToUse)) {
                    nameToUse = 'there'; 
                }

                if (contact.id.user) {
                    extracted.push({
                        name: nameToUse.trim(),
                        phone: contact.id.user
                    });
                }
            }
        }
        
        return extracted;
    }

    async sendMessageWithDelay(phoneNumber, message, minDelayMs = 5000, maxDelayMs = 15000) {
        if (this.status !== 'CONNECTED') {
            throw new Error('WhatsApp is not connected.');
        }

        // Format number appropriately (e.g., append @c.us if not present)
        const formattedNumber = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;

        // 1. Calculate a random delay before "reading/typing"
        const delay = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1) + minDelayMs);
        console.log(`Waiting ${delay}ms before sending to ${phoneNumber}...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));

        // Ensure the account shows as "Online" to WhatsApp servers before typing (Anti-Ban)
        await this.client.sendPresenceAvailable();

        // 2. Simulate typing for a natural amount of time based on message length
        const typingDuration = Math.min(message.length * 100, 5000); // Max 5 seconds typing
        await this.simulateTyping(formattedNumber);
        
        await new Promise(resolve => setTimeout(resolve, typingDuration));
        
        await this.clearTyping(formattedNumber);

        // 3. Send message
        try {
            const response = await this.client.sendMessage(formattedNumber, message);
            console.log(`Message sent successfully to ${phoneNumber}`);

            // Anti-Ban: Randomly go "offline" after sending (50% chance)
            // This prevents WhatsApp from seeing the account as always-online automation
            if (Math.random() > 0.5) {
                await this.client.sendPresenceUnavailable();
            }

            return response;
        } catch (error) {
            console.error(`Failed to send message to ${phoneNumber}:`, error);
            throw error;
        }
    }
}

// Export a singleton instance
const waService = new WhatsAppService();
module.exports = waService;
