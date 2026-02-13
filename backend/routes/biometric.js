const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const {
  registerUserFace,
  verifyUserFace,
  registerUserVoice,
  verifyUserVoice,
  getVoiceSentence,
} = require('../controllers/biometricController');

// Voice routes
router.get('/voice/sentence', getVoiceSentence);

// All routes require authentication
router.use(authenticate);

// Face routes
router.post('/face/register', [
  body().custom((value, { req }) => {
    if (!req.body.faceImage && (!req.body.faceImages || req.body.faceImages.length === 0)) {
      throw new Error('At least one face image is required');
    }
    return true;
  }),
], validate, registerUserFace);

router.post('/face/verify', [
  body('faceImage').notEmpty().withMessage('Face image is required'),
], validate, verifyUserFace);

// Voice routes
router.post('/voice/register', [
  body('voiceAudio').notEmpty().withMessage('Voice audio is required'),
], validate, registerUserVoice);

router.post('/voice/verify', [
  body('voiceAudio').notEmpty().withMessage('Voice audio is required'),
], validate, verifyUserVoice);

module.exports = router;
