require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB, Lead, Reply, Campaign } = require('./database');
const waService = require('./whatsapp');
const { startAutoOutreach } = require('./autoOutreach');

const app = express();

// Start the background autonomous AI outreach worker
startAutoOutreach(waService);
const PORT = 5000;

app.use(cors());
app.use(express.json());

waService.on('reply_received', async (data) => {
    try {
        let displayPhone = data.phone;
        
        await Reply.create({
            name: data.name,
            phone: '+' + displayPhone,
            message: data.message
        });
        console.log(`Saved new reply from ${data.name} (+${displayPhone}): ${data.message}`);
    } catch (err) {
        console.error('Error saving reply:', err);
    }
});

// --- WhatsApp Routes ---

app.get('/api/whatsapp/status', async (req, res) => {
    try {
        const status = await waService.getStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/whatsapp/logout', async (req, res) => {
    try {
        await waService.logout();
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/whatsapp/contacts/extract', async (req, res) => {
    try {
        const contacts = await waService.extractContacts();
        let addedCount = 0;
        
        for (const contact of contacts) {
            const exists = await Lead.findOne({ phone: contact.phone });
            if (!exists) {
                await Lead.create({
                    name: contact.name,
                    phone: contact.phone,
                    tags: 'Extracted'
                });
                addedCount++;
            }
        }
        res.json({ success: true, totalExtracted: contacts.length, added: addedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Leads Routes ---

app.get('/api/leads', async (req, res) => {
    try {
        const leads = await Lead.find().sort({ created_at: -1 });
        res.json(leads);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/leads', async (req, res) => {
    const { name, phone, tags } = req.body;
    if (!name || !phone) {
        return res.status(400).json({ error: 'Name and phone are required.' });
    }
    try {
        const result = await Lead.create({
            name: name,
            phone: phone,
            tags: tags || ''
        });
        res.json({ success: true, id: result._id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/leads/:id', async (req, res) => {
    try {
        await Lead.deleteOne({ _id: req.params.id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// --- Test AI Brain Manually ---
const { autoReplyBrain } = require('./aiBrain');
app.post('/api/test-reply', async (req, res) => {
    const { phone, message, name, chatId } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
    autoReplyBrain(waService, phone, message, name || 'Client', chatId);
    res.json({ success: true, message: 'AI Brain triggered. Reply will be sent after natural delay.' });
});

// --- Campaign/Sending Routes ---

// A simple queue system for managing bulk sends
let isSendingCampaign = false;

app.post('/api/campaigns/send', async (req, res) => {
    const { template, leadIds } = req.body;
    
    if (!template || !leadIds || leadIds.length === 0) {
        return res.status(400).json({ error: 'Template and leadIds are required.' });
    }
    
    if (waService.status !== 'CONNECTED') {
        return res.status(400).json({ error: 'WhatsApp is not connected.' });
    }

    if (isSendingCampaign) {
        return res.status(400).json({ error: 'A campaign is already currently running.' });
    }

    // Start background campaign
    startCampaign(template, leadIds);
    
    res.json({ success: true, message: 'Campaign started in the background.' });
});

// Helper function to parse Spintax like {Hi|Hello|Hey}
function parseSpintax(text) {
    let matches, options, random;
    const regEx = new RegExp(/{([^{}]+?)}/);
    while ((matches = regEx.exec(text)) !== null) {
        options = matches[1].split('|');
        random = Math.floor(Math.random() * options.length);
        text = text.replace(matches[0], options[random]);
    }
    return text;
}

// Helper function to clean unprofessional phonebook names
function cleanName(rawName) {
    if (!rawName || rawName.trim() === '' || rawName.toLowerCase() === 'there' || rawName.toLowerCase() === 'unknown' || rawName.toLowerCase() === 'undefined' || rawName.toLowerCase() === 'null') return '';
    
    // Remove special characters, numbers, and emojis
    let clean = rawName.replace(/[\u1000-\uFFFF]+/g, '').replace(/[^a-zA-Z\s]/g, '');
    
    // Common phonebook tags to ignore
    const badWords = ['personal', 'number', 'work', 'office', 'home', 'bhai', 'ji', 'sir', 'madam', 'new', 'old'];
    
    let words = clean.split(/\s+/).filter(w => w.length > 0 && !badWords.includes(w.toLowerCase()));
    
    if (words.length === 0) return 'there';
    
    // Extract strictly the first name for maximum professionalism
    let firstName = words[0];
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

async function startCampaign(template, leadIds) {
    isSendingCampaign = true;
    console.log(`Starting campaign for ${leadIds.length} leads...`);

    try {
        // Fetch all selected leads
        const leads = await Lead.find({ _id: { $in: leadIds } });

        // Calculate timestamps for Anti-Ban limits
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);

        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];
            
            // --- ANTI-BAN RULE 1: Global 24-Hour Limit ---
            // Count how many messages were sent in the last 24 hours
            const recentSends = await Lead.countDocuments({
                last_messaged_at: { $gt: twentyFourHoursAgo }
            });
            const maxDailyLimit = Math.floor(Math.random() * (80 - 50 + 1) + 50); // Random limit between 50 and 80
            
            if (recentSends >= maxDailyLimit) {
                console.log(`[SAFE STOP] Daily limit reached (${recentSends} sent). Stopping campaign to protect account.`);
                break; // Exit the loop entirely for today
            }

            // --- ANTI-BAN RULE 2: 3-Day Cooldown Per Lead ---
            if (lead.last_messaged_at && lead.last_messaged_at > seventyTwoHoursAgo) {
                console.log(`[SKIP] Skipping ${lead.name}. They were messaged recently. (3-Day Cooldown active)`);
                continue; // Skip this lead and move to the next
            }
            
            // Clean the name for professional outreach
            const safeName = cleanName(lead.name);

            // Replace variables in template
            let customizedMessage = template.replace(/{{name}}/g, safeName);
            // Parse spintax to randomize the message structure for anti-ban
            customizedMessage = parseSpintax(customizedMessage);

            console.log(`Processing lead ${i + 1}/${leads.length}: ${lead.name} -> Cleaned as: ${safeName}`);
            
            try {
                // Extreme Safety Delays: 15 to 30 minutes between each message
                // This naturally spreads the 50-80 messages evenly across the entire 24 hour day!
                await waService.sendMessageWithDelay(
                    lead.phone, 
                    customizedMessage, 
                    15 * 60 * 1000, // 15 minutes
                    30 * 60 * 1000  // 30 minutes
                );

                await Lead.updateOne(
                    { _id: lead._id },
                    { status: 'Sent', last_messaged_at: new Date() }
                );
            } catch (err) {
                console.error(`Failed to send to ${lead.name}: `, err.message);
                await Lead.updateOne({ _id: lead._id }, { status: 'Failed' });
            }

            // Ultra-safe batching: Pause for 10 minutes every 10 messages
            if ((i + 1) % 10 === 0 && i < leads.length - 1) {
                console.log('Safe batch limit reached. Pausing for 10 minutes to avoid ban...');
                await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));
            }
        }
        console.log('Campaign finished successfully!');
    } catch (err) {
        console.error('Error in campaign execution:', err);
    } finally {
        isSendingCampaign = false;
    }
}

// --- Replies Routes ---

app.get('/api/replies', async (req, res) => {
    try {
        const replies = await Reply.find().sort({ created_at: -1 });
        res.json(replies);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/replies/:id/read', async (req, res) => {
    try {
        await Reply.updateOne({ _id: req.params.id }, { is_read: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, async () => {
    // Connect to MongoDB
    await connectDB(process.env.MONGODB_URI);
    console.log(`Server is running on http://localhost:${PORT}`);
});
