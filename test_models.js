const fetch = require('node-fetch') || globalThis.fetch;
require('dotenv').config();

async function testModel(modelName) {
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: 'hello' }]
            })
        });
        const data = await response.json();
        console.log(`\nModel: ${modelName}`);
        if (data.error) {
            console.log('ERROR:', data.error.message);
        } else if (data.choices) {
            console.log('SUCCESS:', data.choices[0].message.content);
        }
    } catch (err) {
        console.log(`\nModel: ${modelName}`);
        console.log('CRASH:', err.message);
    }
}

async function runTests() {
    await testModel('google/gemma-2-9b-it:free');
    await testModel('openrouter/auto');
    await testModel('microsoft/phi-3-medium-128k-instruct:free');
    await testModel('huggingfaceh4/zephyr-7b-beta:free');
}

runTests();
