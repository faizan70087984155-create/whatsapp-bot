const http = require('http');

const data = JSON.stringify({
    phone: '917008818317',
    message: 'Who are You ???',
    name: 'nirmalsahoo'
});

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
    res.on('end', () => console.log('Response:', resData));
});
req.on('error', e => console.error(e));
req.write(data);
req.end();
