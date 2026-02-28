const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');
require('dotenv').config();

const FACE_SERVICE_URL = 'http://localhost:8000';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');

  // get the newest teacher
  const teacher = await User.findOne({role: 'TEACHER'}).sort({_id: -1}).select('+faceEncoding +faceImageData');
  
  if (!teacher || !teacher.faceImageData) {
    console.log("No teacher with image");
    process.exit(0);
  }

  console.log(`Testing verification for ${teacher.email} (${teacher._id})`);

  try {
    const formData = new FormData();
    formData.append('user_id', teacher._id.toString());
    formData.append('file', teacher.faceImageData, { filename: 'face.jpg' });

    const response = await axios.post(`${FACE_SERVICE_URL}/verify-face`, formData, {
      headers: formData.getHeaders(),
    });
    
    console.log("Python response:", JSON.stringify(response.data, null, 2));

  } catch (err) {
    console.error("Error from Python:");
    if (err.response) {
       console.error(err.response.status, JSON.stringify(err.response.data, null, 2));
    } else {
       console.error(err.message);
    }
  }

  process.exit(0);
})();
