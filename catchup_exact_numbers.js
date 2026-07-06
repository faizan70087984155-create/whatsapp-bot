const http = require('http');

// Using the exact phone numbers provided by the user
const pendingReplies = [
    { name: 'Zmark', phone: '917235000887', message: 'Wo deliver nhi hua tha', chatId: '917235000887@c.us' },
    { name: 'Ad', phone: '923359399292', message: 'Mre pchli payment pending hy return ni ki ap ny', chatId: '923359399292@c.us' }
];

async function processAll() {
    console.log('Sending replies using exact phone numbers...');
    
    for (const reply of pendingReplies) {
        await new Promise((resolve) => {
            const data = JSON.stringify(reply);
            const options = {
                hostname: 'localhost',
                port: 5000,
                path: '/api/test-reply',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = http.request(options, res => {
                let resData = '';
                res.on('data', d => resData += d);
                res.on('end', () => {
                    console.log(`Triggered AI Brain for ${reply.name}: ${resData}`);
                    resolve();
                });
            });
            req.on('error', e => {
                console.error(`Error for ${reply.name}:`, e.message);
                resolve();
            });
            req.write(data);
            req.end();
        });
        
        // Wait 15 seconds to ensure natural spacing
        await new Promise(r => setTimeout(r, 15000));
    }
    console.log('Finished triggering replies!');
}

processAll();
