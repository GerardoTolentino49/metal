const http = require('http');

const postData = JSON.stringify({
  partNumber: '123',
  username: 'gerardo'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/diseno/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';

  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS:`, JSON.stringify(res.headers));

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('BODY:', JSON.parse(data));
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
  process.exit(1);
});

// Write data to request body
req.write(postData);
req.end();
