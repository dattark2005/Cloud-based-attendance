const https = require('https');
const http = require('http');

async function testNative(url) {
    console.log('Testing url:', url);

    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            console.log('Status:', res.statusCode);
            if (res.statusCode >= 400) {
                reject(new Error(`Bad status: ${res.statusCode}`));
                return;
            }
            let size = 0;
            res.on('data', chunk => size += chunk.length);
            res.on('end', () => {
                console.log('Success, size:', size);
                resolve(size);
            });
        }).on('error', (err) => {
            console.error('Network Error:', err.message);
            reject(err);
        });
    });
}

testNative('https://via.placeholder.com/150');
