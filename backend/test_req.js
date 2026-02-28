const http = require('http');

http.get('http://localhost:3001/dev/users', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const users = JSON.parse(data).users.reverse().slice(0, 5); // get last 5
    
    users.forEach(u => {
      http.get(`http://localhost:3001/dev/face-check?email=${encodeURIComponent(u.email)}`, (res2) => {
        let fData = '';
        res2.on('data', c => fData += c);
        res2.on('end', () => {
          const fc = JSON.parse(fData);
          console.log(`\nUser: ${u.email} (${u.role})`);
          console.log(`Has 1024-byte face: ${fc.faceEncodingIsValid1024} (Bytes: ${fc.faceEncodingBytes})`);
        });
      });
    });
  });
});
