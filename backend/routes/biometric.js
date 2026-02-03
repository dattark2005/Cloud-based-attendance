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
} = require('../controllers/biometricController');

// All routes require authentication
router.use(authenticate);

// Face routes
router.post('/face/register', [
  body('faceImage').notEmpty().withMessage('Face image is required'),
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
