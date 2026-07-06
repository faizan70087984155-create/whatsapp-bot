const fetch = require('node-fetch') || globalThis.fetch;
require('dotenv').config();

async function findWorkingFreeModels() {
    try {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        const data = await response.json();
        
        const freeModels = data.data.filter(m => m.pricing.prompt === '0' && m.pricing.completion === '0');
        
        console.log(`Found ${freeModels.length} free models. Testing the top 10 by context length...`);
        freeModels.sort((a,b) => b.context_length - a.context_length);
        
        for (let i = 0; i < Math.min(10, freeModels.length); i++) {
            const modelId = freeModels[i].id;
            console.log(`\nTesting: ${modelId}`);
            try {
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelId,
                        messages: [{ role: 'user', content: 'Say hello in 1 word' }]
                    })
                });
                const d = await res.json();
                if (d.error) {
                    console.log('  ERROR:', d.error.message);
                } else if (d.choices && d.choices.length > 0) {
                    console.log('  SUCCESS:', d.choices[0].message.content.trim());
                }
            } catch(e) {
                console.log('  FAILED TO CONNECT');
            }
        }
    } catch(e) {
        console.error("Fatal error:", e);
    }
}

findWorkingFreeModels();
