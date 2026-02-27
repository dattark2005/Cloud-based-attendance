const axios = require('axios');

async function testProxy() {
    try {
        // Testing a dummy placeholder image first
        const testUrl = 'https://via.placeholder.com/150';
        console.log(`Testing fetch for ${testUrl}...`);
        const res = await axios.get(`http://localhost:3001/api/auth/proxy-image?url=${encodeURIComponent(testUrl)}`);
        console.log('Success!', res.status, res.headers['content-type']);
    } catch (err) {
        console.error('Test Failed!');
        if (err.response) {
            console.error(err.response.status, err.response.data);
        } else {
            console.error(err.message);
        }
    }
}

testProxy();
