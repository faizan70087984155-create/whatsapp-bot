const mongoose = require('mongoose');

// Define Leads Schema
const leadSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    status: { type: String, default: 'New' },
    tags: { type: String, default: '' },
    last_messaged_at: { type: Date },
    bot_stage: { type: Number, default: 0 },
    bot_intent: { type: String },
    bot_lang: { type: String },
    last_template: { type: String },
    created_at: { type: Date, default: Date.now }
});

const Lead = mongoose.model('Lead', leadSchema);

// Define Replies Schema (Response Catcher)
const replySchema = new mongoose.Schema({
    name: { type: String },
    phone: { type: String, required: true },
    message: { type: String, required: true },
    is_read: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now }
});

const Reply = mongoose.model('Reply', replySchema);

// Define Campaigns Schema
const campaignSchema = new mongoose.Schema({
    name: { type: String, required: true },
    message_template: { type: String, required: true },
    status: { type: String, default: 'Draft' },
    created_at: { type: Date, default: Date.now }
});

const Campaign = mongoose.model('Campaign', campaignSchema);

// Connect to MongoDB
async function connectDB(uri) {
    if (mongoose.connection.readyState === 1) return; // Already connected
    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB Cloud successfully!');
    } catch (error) {
        console.error('MongoDB connection error:', error.message);
        throw error;
    }
}

module.exports = {
    connectDB,
    Lead,
    Reply,
    Campaign
};
