require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { connectDB, Lead, Reply, Campaign } = require('./database');

async function migrateData() {
    const dataPath = path.join(__dirname, 'data.json');
    const migratedPath = path.join(__dirname, 'data.json.migrated');

    if (!fs.existsSync(dataPath)) {
        console.log('No data.json found. Skipping migration.');
        return;
    }

    if (fs.existsSync(migratedPath)) {
        console.log('Migration already completed previously. Skipping.');
        return;
    }

    if (!process.env.MONGODB_URI) {
        console.log('No MONGODB_URI provided. Skipping migration.');
        return;
    }

    try {
        await connectDB(process.env.MONGODB_URI);
        console.log('Connected to MongoDB. Starting migration from JSON...');

        const fileData = fs.readFileSync(dataPath, 'utf-8');
        const dbData = JSON.parse(fileData);

        // 1. Migrate Leads
        console.log('Migrating leads...');
        try {
            const leads = dbData.leads || [];
            let leadsAdded = 0;
            for (const lead of leads) {
                const exists = await Lead.findOne({ phone: lead.phone });
                if (!exists) {
                    await Lead.create({
                        name: lead.name,
                        phone: lead.phone,
                        status: lead.status,
                        tags: lead.tags,
                        last_messaged_at: lead.last_messaged_at ? new Date(lead.last_messaged_at) : null,
                        bot_stage: lead.bot_stage,
                        bot_intent: lead.bot_intent,
                        bot_lang: lead.bot_lang,
                        last_template: lead.last_template,
                        created_at: new Date(lead.created_at)
                    });
                    leadsAdded++;
                }
            }
            console.log(`Migrated ${leadsAdded}/${leads.length} leads successfully.`);
        } catch (e) {
            console.log('Leads parsing error:', e.message);
        }

        // 2. Migrate Replies
        console.log('Migrating replies...');
        try {
            const replies = dbData.replies || [];
            let repliesAdded = 0;
            for (const reply of replies) {
                const exists = await Reply.findOne({ phone: reply.phone, message: reply.message });
                if (!exists) {
                    await Reply.create({
                        name: reply.name,
                        phone: reply.phone,
                        message: reply.message,
                        is_read: reply.is_read === 1,
                        created_at: new Date(reply.created_at)
                    });
                    repliesAdded++;
                }
            }
            console.log(`Migrated ${repliesAdded}/${replies.length} replies successfully.`);
        } catch (e) {
            console.log('Replies parsing error:', e.message);
        }

        // 3. Migrate Campaigns
        console.log('Migrating campaigns...');
        try {
            const campaigns = dbData.campaigns || [];
            let campsAdded = 0;
            for (const camp of campaigns) {
                const exists = await Campaign.findOne({ name: camp.name });
                if (!exists) {
                    await Campaign.create({
                        name: camp.name,
                        message_template: camp.message_template,
                        status: camp.status,
                        created_at: new Date(camp.created_at)
                    });
                    campsAdded++;
                }
            }
            console.log(`Migrated ${campsAdded}/${campaigns.length} campaigns successfully.`);
        } catch (e) {
            console.log('Campaigns parsing error:', e.message);
        }

        // Rename file to prevent future migrations
        fs.renameSync(dataPath, migratedPath);
        console.log('Migration complete. data.json renamed to data.json.migrated');
        
    } catch (error) {
        console.error('Migration failed:', error);
    }
}

if (require.main === module) {
    migrateData().then(() => {
        console.log('Migration script finished.');
        process.exit(0);
    });
} else {
    module.exports = migrateData;
}
