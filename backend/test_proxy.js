const axios = require('axios');

async function testProxy() {
    try {
        const res = await axios.get('http://localhost:3001/api/auth/proxy-image?url=https://via.placeholder.com/400x400?text=Face+Registered+Local');
        console.log(res.status);
    } catch (err) {
        if (err.response) {
            console.error(err.response.status, err.response.data);
        } else {
            console.error(err.message);
        }
    }
}

testProxy();
