const waService = require('./whatsapp');
const { autoReplyBrain } = require('./aiBrain');

const pending = [
    { name: 'Zmark', msg: 'Wo deliver nhi hua tha', phone: '210109951143964' },
    { name: 'Ad', msg: 'Mre pchli payment pending hy return ni ki ap ny', phone: '19902962393187' }
];

waService.on('status_change', async (statusInfo) => {
    if (statusInfo.status === 'CONNECTED') {
        console.log('Connected. Finding exact chat IDs...');
        const chats = await waService.client.getChats();
        
        for (const p of pending) {
            // Find chat by name match
            const chat = chats.find(c => c.name === p.name || (c.contact && (c.contact.pushname === p.name || c.contact.name === p.name)));
            if (chat) {
                console.log(`Found exact Chat ID for ${p.name}: ${chat.id._serialized}`);
                await autoReplyBrain(waService, p.phone, p.msg, p.name, chat.id._serialized);
            } else {
                console.log(`Could not find chat for ${p.name}`);
            }
        }
        
        setTimeout(() => process.exit(0), 10000);
    }
});
