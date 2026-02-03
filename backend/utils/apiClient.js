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
    formData.append('image', imageBuffer, { filename: 'face.jpg' });

    const response = await axios.post(`${FACE_SERVICE_URL}/register`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error('Face registration error:', error.message);
    throw new Error('Failed to register face with recognition service');
  }
};

/**
 * Verify face with Python face recognition service
 * @param {string} userId - User ID
 * @param {Buffer} imageBuffer - Face image buffer
 * @returns {Promise<object>} Verification result
 */
const verifyFace = async (userId, imageBuffer) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('image', imageBuffer, { filename: 'face.jpg' });

    const response = await axios.post(`${FACE_SERVICE_URL}/verify`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error('Face verification error:', error.message);
    throw new Error('Failed to verify face');
  }
};

/**
 * Identify face (find matching user)
 * @param {Buffer} imageBuffer - Face image buffer
 * @returns {Promise<object>} Identification result
 */
const identifyFace = async (imageBuffer) => {
  try {
    const formData = new FormData();
    formData.append('image', imageBuffer, { filename: 'face.jpg' });

    const response = await axios.post(`${FACE_SERVICE_URL}/identify`, formData, {
      headers: formData.getHeaders(),
      timeout: 10000,
    });

    return response.data;
  } catch (error) {
    console.error('Face identification error:', error.message);
    throw new Error('Failed to identify face');
  }
};

/**
 * Register voice with Python voice recognition service
 * @param {string} userId - User ID
 * @param {Buffer} audioBuffer - Voice audio buffer
 * @returns {Promise<object>} Voice embedding data
 */
const registerVoice = async (userId, audioBuffer) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('audio', audioBuffer, { filename: 'voice.wav' });

    const response = await axios.post(`${VOICE_SERVICE_URL}/register`, formData, {
      headers: formData.getHeaders(),
      timeout: 15000,
    });

    return response.data;
  } catch (error) {
    console.error('Voice registration error:', error.message);
    throw new Error('Failed to register voice with recognition service');
  }
};

/**
 * Verify voice with Python voice recognition service
 * @param {string} userId - User ID
 * @param {Buffer} audioBuffer - Voice audio buffer
 * @returns {Promise<object>} Verification result
 */
const verifyVoice = async (userId, audioBuffer) => {
  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('audio', audioBuffer, { filename: 'voice.wav' });

    const response = await axios.post(`${VOICE_SERVICE_URL}/verify`, formData, {
      headers: formData.getHeaders(),
      timeout: 15000,
    });

    return response.data;
  } catch (error) {
    console.error('Voice verification error:', error.message);
    throw new Error('Failed to verify voice');
  }
};

module.exports = {
  registerFace,
  verifyFace,
  identifyFace,
  registerVoice,
  verifyVoice,
};
