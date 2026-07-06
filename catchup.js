const http = require('http');

// Old replies that need processing
const pendingReplies = [
    { name: 'Zmark', phone: '210109951143964', message: 'Wo deliver nhi hua tha' },
    { name: 'Ad', phone: '19902962393187', message: 'Mre pchli payment pending hy return ni ki ap ny' }
];

async function processAll() {
    console.log('Processing remaining old replies...');
    
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
        
        // Wait 5 seconds between triggering them
        await new Promise(r => setTimeout(r, 5000));
    }
    console.log('Finished triggering remaining replies!');
}

processAll();
