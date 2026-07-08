const { Lead } = require('./database');
const { generateAIOutreach } = require('./llm');

let isOutreachRunning = false;

// Helper function to clean unprofessional phonebook names
function cleanName(rawName) {
    if (!rawName || rawName.trim() === '' || rawName.toLowerCase() === 'there' || rawName.toLowerCase() === 'unknown' || rawName.toLowerCase() === 'undefined' || rawName.toLowerCase() === 'null') return '';
    
    // Remove special characters, numbers, and emojis
    let clean = rawName.replace(/[\u1000-\uFFFF]+/g, '').replace(/[^a-zA-Z\s]/g, '');
    
    // Common phonebook tags to ignore
    const badWords = ['personal', 'number', 'work', 'office', 'home', 'bhai', 'ji', 'sir', 'madam', 'new', 'old'];
    
    let words = clean.split(/\s+/).filter(w => w.length > 0 && !badWords.includes(w.toLowerCase()));
    
    if (words.length === 0) return '';
    
    // Extract strictly the first name for maximum professionalism
    let firstName = words[0];
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

async function startAutoOutreach(waService) {
    if (isOutreachRunning) return;
    isOutreachRunning = true;
    
    console.log('[Auto-Outreach] Background worker started. Scanning for leads...');

    let isProcessing = false;

    // Function that processes one lead and schedules the next run
    const processNextLead = async () => {
        if (isProcessing) return;
        isProcessing = true;
        
        let nextDelayMs = 2 * 60 * 1000; // Default: If idle/error, check again in 2 mins
        
        try {
            if (waService.status !== 'CONNECTED') {
                isProcessing = false;
                setTimeout(processNextLead, 5000); // Check fast if not connected
                return;
            }

            // --- 0. CIRCADIAN RHYTHM (SLEEP CYCLE) ---
            const currentHour = new Date().getHours();
            if (currentHour >= 0 && currentHour < 7) {
                console.log(`[Auto-Outreach] Sleep Mode. It's ${currentHour} AM. Sleeping to act human...`);
                nextDelayMs = 60 * 60 * 1000; // Check again in 1 hour
                throw new Error("SLEEP_MODE");
            }

            // --- GLOBAL 24-HOUR SAFETY LIMIT ---
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentSends = await Lead.countDocuments({
                last_messaged_at: { $gt: twentyFourHoursAgo }
            });
            const maxDailyLimit = 65; 
            
            if (recentSends >= maxDailyLimit) {
                console.log(`[Auto-Outreach] Sleep Mode. 24-hour limit reached (${recentSends}/${maxDailyLimit}). Resting...`);
                nextDelayMs = 30 * 60 * 1000; // Wait 30 mins before checking if the 24h window moved
                throw new Error("SLEEP_MODE");
            }

            // --- 1. FIND NEW LEADS (Never Contacted) ---
            let targetLead = await Lead.findOne({ $or: [{ status: 'New' }, { tags: 'Extracted' }] }).sort({ created_at: 1 });
            let isFollowUp = false;

            // --- 2. FIND FOLLOW-UP LEADS (Contacted > 3 Days Ago) ---
            if (!targetLead) {
                const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
                targetLead = await Lead.findOne({ status: 'Sent', last_messaged_at: { $lt: threeDaysAgo } }).sort({ last_messaged_at: 1 });
                if (targetLead) {
                    isFollowUp = true;
                }
            }

            if (!targetLead) {
                // No leads to process right now. Just idle.
                throw new Error("IDLE");
            }

            // Skip invalid phone numbers (like '0' or anything too short)
            if (!targetLead.phone || targetLead.phone.length < 10) {
                console.log(`[Auto-Outreach] Skipping Lead ID ${targetLead._id} due to invalid phone: ${targetLead.phone}`);
                await Lead.updateOne({ _id: targetLead._id }, { status: 'Skipped_Invalid', tags: '' });
                nextDelayMs = 2000; // Check the next one immediately
                throw new Error("INVALID_SKIPPED");
            }

            const safeName = cleanName(targetLead.name);
            console.log(`[Auto-Outreach] Processing Lead: ${targetLead.phone} | Name: ${safeName || 'Unknown'} | Type: ${isFollowUp ? 'Follow-Up' : 'First Message'}`);

            // 5% chance of getting distracted (random 2-5 min pause before even typing)
            if (Math.random() < 0.05) {
                const distractionMs = Math.floor(Math.random() * (5 * 60 * 1000 - 2 * 60 * 1000 + 1)) + 2 * 60 * 1000;
                console.log(`[Auto-Outreach] Got distracted... pausing for ${Math.floor(distractionMs/1000)}s before acting.`);
                await new Promise(r => setTimeout(r, distractionMs));
            }

            const chatId = targetLead.phone.includes('@') ? targetLead.phone : `${targetLead.phone}@c.us`;
            
            // Check if the number actually exists on WhatsApp before wasting AI tokens
            const isRegistered = await waService.client.isRegisteredUser(chatId);
            if (!isRegistered) {
                console.log(`[Auto-Outreach] Skipping Lead ID ${targetLead._id} because the number is NOT on WhatsApp: ${targetLead.phone}`);
                await Lead.updateOne({ _id: targetLead._id }, { status: 'Skipped_Invalid', tags: '' });
                nextDelayMs = 2000; // Check the next one immediately
                throw new Error("INVALID_SKIPPED");
            }

            // Generate Smart AI Message
            const message = await generateAIOutreach(safeName, isFollowUp);
            if (!message) throw new Error("AI generated empty message");

            const chat = await waService.client.getChatById(chatId).catch(() => null);

            // Extreme Safety Delays before sending (simulate human typing/thinking)
            const prepDelay = Math.floor(Math.random() * (3000 - 1000 + 1) + 1000);
            await new Promise(r => setTimeout(r, prepDelay));

            // Typing Simulation
            if (chat) {
                await chat.sendStateTyping();
            }
            const typeTime = Math.floor(Math.random() * (12000 - 5000 + 1)) + 5000;
            await new Promise(r => setTimeout(r, typeTime));
            if (chat) {
                await chat.clearState();
            }

            // Send via WA
            try {
                await waService.client.sendMessage(chatId, message);
                console.log(`[Auto-Outreach] Successfully sent ${isFollowUp ? 'Follow-Up' : 'First Message'} to ${targetLead.phone}`);

                // Update Database
                const newStatus = isFollowUp ? 'Followed_Up' : 'Sent';
                await Lead.updateOne(
                    { _id: targetLead._id },
                    { status: newStatus, tags: '', last_messaged_at: new Date() }
                );
            } catch (sendError) {
                console.log(`[Auto-Outreach] Failed to send message to ${targetLead.phone}: ${sendError.message}`);
                await Lead.updateOne(
                    { _id: targetLead._id },
                    { status: 'Failed', tags: 'Send_Error', last_messaged_at: new Date() }
                );
            }

            // ORGANIC DISTRIBUTION: Random delay between 17 to 21 minutes to distribute exactly ~70-80 msgs over 24 hours safely
            nextDelayMs = Math.floor(Math.random() * (21 * 60 * 1000 - 17 * 60 * 1000 + 1)) + 17 * 60 * 1000;
            console.log(`[Auto-Outreach] Taking a human break. Next outreach in ${Math.floor(nextDelayMs / 60000)} minutes to look totally organic...`);

        } catch (error) {
            if (error.message !== "IDLE" && error.message !== "SLEEP_MODE" && error.message !== "INVALID_SKIPPED") {
                console.error('[Auto-Outreach] Loop Error:', error.message);
            }
        } finally {
            isProcessing = false;
            setTimeout(processNextLead, nextDelayMs);
        }
    };

    // Clean startup trigger
    let startupTimeout;
    const triggerOutreach = () => {
        if (startupTimeout) clearTimeout(startupTimeout);
        startupTimeout = setTimeout(() => {
            if (waService.status === 'CONNECTED') {
                processNextLead();
            }
        }, 5000);
    };

    triggerOutreach();
    
    if (waService.on) {
        waService.on('status_change', (data) => {
            if (data.status === 'CONNECTED') {
                triggerOutreach();
            }
        });
    }
}

module.exports = { startAutoOutreach };
