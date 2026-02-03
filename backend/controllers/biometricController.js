const User = require('../models/User');
const { uploadToCloudinary } = require('../config/cloudinary');
const { registerFace, verifyFace, registerVoice, verifyVoice } = require('../utils/apiClient');
const { CLOUDINARY_FOLDERS, ROLES } = require('../config/constants');

/**
 * Register face for user
 * POST /api/biometric/face/register
 */
const registerUserFace = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { faceImage } = req.body;

    if (!faceImage) {
      return res.status(400).json({
        success: false,
        message: 'Face image is required',
      });
    }

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    // Upload to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(
      `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
      CLOUDINARY_FOLDERS.FACES,
      'image'
    );

    // Register with Python face recognition service
    const faceResult = await registerFace(userId.toString(), imageBuffer);

    // Update user with face data
    const user = await User.findByIdAndUpdate(
      userId,
      {
        faceEncoding: Buffer.from(JSON.stringify(faceResult.encoding)),
        faceImageUrl: cloudinaryResult.url,
        faceRegisteredAt: new Date(),
      },
      { new: true }
    ).select('-password -faceEncoding -voiceEmbedding');

    res.json({
      success: true,
      message: 'Face registered successfully',
      data: { user },
    });
  } catch (error) {
    console.error('Face registration error:', error);
    next(error);
  }
};

/**
 * Verify face for user
 * POST /api/biometric/face/verify
 */
const verifyUserFace = async (req, res, next) => {
  try {
    const { userId, faceImage } = req.body;
    const targetUserId = userId || req.user._id;

    if (!faceImage) {
      return res.status(400).json({
        success: false,
        message: 'Face image is required',
      });
    }

    // Check if user has registered face
    const user = await User.findById(targetUserId);
    if (!user || !user.faceEncoding) {
      return res.status(400).json({
        success: false,
        message: 'User has not registered face',
      });
    }

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    // Verify with Python face recognition service
    const verificationResult = await verifyFace(targetUserId.toString(), imageBuffer);

    res.json({
      success: true,
      message: verificationResult.verified ? 'Face verified successfully' : 'Face verification failed',
      data: {
        verified: verificationResult.verified,
        confidence: verificationResult.confidence,
        userId: targetUserId,
      },
    });
  } catch (error) {
    console.error('Face verification error:', error);
    next(error);
  }
};

/**
 * Register voice for user (teachers only)
 * POST /api/biometric/voice/register
 */
const registerUserVoice = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { voiceAudio } = req.body;

    // Check if user is teacher or admin
    if (req.user.role !== ROLES.TEACHER && req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Only teachers and admins can register voice',
      });
    }

    if (!voiceAudio) {
      return res.status(400).json({
        success: false,
        message: 'Voice audio is required',
      });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(voiceAudio.replace(/^data:audio\/\w+;base64,/, ''), 'base64');

    // Upload to Cloudinary
    const cloudinaryResult = await uploadToCloudinary(
      `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
      CLOUDINARY_FOLDERS.VOICES,
      'video' // Cloudinary treats audio as video
    );

    // Register with Python voice recognition service
    const voiceResult = await registerVoice(userId.toString(), audioBuffer);

    // Update user with voice data
    const user = await User.findByIdAndUpdate(
      userId,
      {
        voiceEmbedding: Buffer.from(JSON.stringify(voiceResult.embedding)),
        voiceAudioUrl: cloudinaryResult.url,
        voiceRegisteredAt: new Date(),
      },
      { new: true }
    ).select('-password -faceEncoding -voiceEmbedding');

    res.json({
      success: true,
      message: 'Voice registered successfully',
      data: { user },
    });
  } catch (error) {
    console.error('Voice registration error:', error);
    next(error);
  }
};

/**
 * Verify voice for user
 * POST /api/biometric/voice/verify
 */
const verifyUserVoice = async (req, res, next) => {
  try {
    const { userId, voiceAudio } = req.body;
    const targetUserId = userId || req.user._id;

    if (!voiceAudio) {
      return res.status(400).json({
        success: false,
        message: 'Voice audio is required',
      });
    }

    // Check if user has registered voice
    const user = await User.findById(targetUserId);
    if (!user || !user.voiceEmbedding) {
      return res.status(400).json({
        success: false,
        message: 'User has not registered voice',
      });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(voiceAudio.replace(/^data:audio\/\w+;base64,/, ''), 'base64');

    // Verify with Python voice recognition service
    const verificationResult = await verifyVoice(targetUserId.toString(), audioBuffer);

    res.json({
      success: true,
      message: verificationResult.verified ? 'Voice verified successfully' : 'Voice verification failed',
      data: {
        verified: verificationResult.verified,
        confidence: verificationResult.confidence,
        userId: targetUserId,
      },
    });
  } catch (error) {
    console.error('Voice verification error:', error);
    next(error);
  }
};

module.exports = {
  registerUserFace,
  verifyUserFace,
  registerUserVoice,
  verifyUserVoice,
};
