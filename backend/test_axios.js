const axios = require('axios');

async function testFetch() {
    const url = 'https://via.placeholder.com/150';
    try {
        const response = await axios({
            method: 'get',
            url: decodeURIComponent(url),
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        console.log('Success, buffer length:', Buffer.from(response.data).length);
    } catch (error) {
        console.error('Proxy error fetching URL:', url);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Headers:', error.response.headers);
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error Details:', error.message);
        }
    }
}

testFetch();
