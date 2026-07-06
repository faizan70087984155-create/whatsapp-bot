const { dbAll } = require('./database.js');

// Find the actual phone numbers of leads who replied
dbAll("SELECT name, phone FROM leads WHERE name LIKE '%mark%' OR name LIKE '%nirmal%' OR name LIKE '%Ad%' LIMIT 10")
  .then(rows => {
    console.log('Matching leads:');
    rows.forEach(r => console.log(r.name, '->', r.phone));
  });
