const axios = require('axios');
const FormData = require('form-data');

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://localhost:8000';
const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL || 'http://localhost:8001';

/**
 * Register face with Python face recognition service
 * @param {string} userId - User ID
 * @param {Buffer} imageBuffer - Face image buffer
 * @returns {Promise<object>} Face encoding data
 */
const registerFace = async (userId, imageBuffer) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('file', imageBuffer, { filename: 'face.jpg' });

    const response = await axios.post(`${FACE_SERVICE_URL}/register-face`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error('Face registration error:', error.message);
    throw new Error('Failed to register face with recognition service');
  }
};

const verifyFace = async (userId, imageBuffer) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('file', imageBuffer, { filename: 'face.jpg' });

    const response = await axios.post(`${FACE_SERVICE_URL}/verify-face`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error('Face verification error:', error.message);
    throw new Error('Failed to verify face');
  }
};

const identifyFace = async (imageBuffer) => {
  try {
    const formData = new FormData();
    formData.append('file', imageBuffer, { filename: 'face.jpg' });

    const response = await axios.post(`${FACE_SERVICE_URL}/identify-face`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error('Face identification error:', error.message);
    throw new Error('Failed to identify face');
  }
};

const registerVoice = async (userId, audioBuffer) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('file', audioBuffer, { filename: 'voice.wav' });

    const response = await axios.post(`${VOICE_SERVICE_URL}/register-voice`, formData, {
      headers: formData.getHeaders(),
      timeout: 15000,
    });

    return response.data;
  } catch (error) {
    console.error('Voice registration error:', error.message);
    throw new Error('Failed to register voice with recognition service');
  }
};

const verifyVoice = async (userId, audioBuffer, expectedText = null) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('file', audioBuffer, { filename: 'voice.wav' });
    if (expectedText) {
      formData.append('expected_text', expectedText);
    }

    const response = await axios.post(`${VOICE_SERVICE_URL}/verify-voice`, formData, {
      headers: formData.getHeaders(),
      timeout: 20000, // Potential STT delay
    });

    return response.data;
  } catch (error) {
    console.error('Voice verification error:', error.message);
    throw new Error('Failed to verify voice');
  }
};

const batchRegisterFace = async (userId, imageBuffers) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);

    imageBuffers.forEach((buffer, index) => {
      formData.append('files', buffer, { filename: `face_${index}.jpg` });
    });

    const response = await axios.post(`${FACE_SERVICE_URL}/batch-register-face`, formData, {
      headers: formData.getHeaders(),
      timeout: 30000, // Longer timeout for multiple images
    });

    return response.data;
  } catch (error) {
    console.error('Batch face registration error:', error.message);
    throw new Error('Failed to register face samples');
  }
};

module.exports = {
  registerFace,
  batchRegisterFace,
  verifyFace,
  identifyFace,
  registerVoice,
  verifyVoice,
};
