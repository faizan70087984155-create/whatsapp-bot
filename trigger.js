const { dbAll } = require('./database.js'); 
const http = require('http'); 

dbAll("SELECT id FROM leads WHERE status != 'Sent'").then(rows => { 
    const leadIds = rows.map(r => r.id); 
    const data = JSON.stringify({ 
        leadIds, 
        template: `{Hi|Hello|Hey|Greetings|Hi there|Good day} {{name}},\n\n{I hope this message finds you well.|Hope you're having a productive week!|Trust you're doing great.|Hope you are having a fantastic day!|Hope you're having a great week so far!}\n\n{This is|It's} Abhijeet Sharma {reaching out|here} from {the team at SafeTrafficPro|SafeTrafficPro}. {I was reviewing my contacts and realized it’s been a while since we connected.|I noticed we haven't spoken in a bit and wanted to reconnect.|I was just going through my network and thought of you.|It's been a while, so I wanted to drop a quick note to reconnect.|I'm reaching out to my network today and wanted to say hi.}\n\n{I wanted to quickly reach out personally because|The reason for my message is that|I'm dropping you this quick note because|I wanted to share a quick update with you because} we just {rolled out|launched|introduced|released|unveiled} a {special|exclusive|limited-time} 20% discount on our {premium |}Website Traffic service.\n\n{It's currently the absolute best solution available|It's widely considered the top solution out there|It's proven to be the most effective strategy} for {loading self-traffic securely|driving secure, high-quality self-traffic|boosting your traffic metrics safely}. {It works wonders for|It's incredibly effective at|It has a fantastic track record of} getting your site noticed in Google Discover and gives your overall SEO optimization a {massive boost|significant advantage|powerful push|huge lift}.\n\n{Are you currently looking for ways to scale your website traffic?|Would you be open to hearing more about how this works?|If you're interested, I can send over the details or a quick link for you to check out.|I'd love to know if this is something you're focusing on right now?|Feel free to check out the details here: https://safetrafficpro.com/product/website-traffic/ |Let me know if you'd like me to share the link to this offer!}\n\n{Best|Cheers|Warm regards|Best regards|Talk soon|Looking forward to connecting},\nAbhijeet`
    }); 
    const options = { 
        hostname: 'localhost', 
        port: 5000, 
        path: '/api/campaigns/send', 
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
});
