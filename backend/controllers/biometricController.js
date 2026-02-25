const User = require('../models/User');
const { uploadToCloudinary } = require('../config/cloudinary');
const { registerFace, batchRegisterFace, verifyFace, registerVoice, verifyVoice } = require('../utils/apiClient');
const { ROLES, CLOUDINARY_FOLDERS } = require('../config/constants');

/**
 * Register face for user (Support multiple angles)
 * POST /api/biometric/face/register
 */
const registerUserFace = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { faceImage, faceImages } = req.body;

    const imagesToProcess = faceImages || (faceImage ? [faceImage] : null);

    if (!imagesToProcess || imagesToProcess.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one face image is required',
      });
    }

    // Convert base64 array to buffer array
    const imageBuffers = imagesToProcess.map(img =>
      Buffer.from(img.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    );

    let faceResult;
    try {
      if (imageBuffers.length > 1) {
        faceResult = await batchRegisterFace(userId.toString(), imageBuffers);
      } else {
        faceResult = await registerFace(userId.toString(), imageBuffers[0]);
      }
    } catch (serviceError) {
      console.warn('⚠️ Python AI service failed or unreachable. Falling back to Mock Registration.');

      let imageUrl = 'https://via.placeholder.com/400x400?text=Face+Registered+Local';
      try {
        console.log('🔄 Attempting Cloudinary upload fallback...');
        // Ensure we pass the base64 string with the proper prefix if it's missing
        const fileToUpload = imagesToProcess[0].startsWith('data:')
          ? imagesToProcess[0]
          : `data:image/jpeg;base64,${imagesToProcess[0]}`;

        const cloudinaryResult = await uploadToCloudinary(
          fileToUpload,
          'attendance/faces'
        );
        imageUrl = cloudinaryResult.url;
        console.log('✅ Fallback Cloudinary upload successful');
      } catch (cloudinaryErr) {
        console.error('⚠️ Fallback Cloudinary failed:', cloudinaryErr.message);
        console.warn('⚠️ Using placeholder URL instead.');
      }

      // Create a dummy 128-float vector (serialized)
      const mockVector = Buffer.alloc(128 * 8); // 128 float64 values (8 bytes each)

      await User.findByIdAndUpdate(userId, {
        faceEncoding: mockVector,
        faceImageUrl: imageUrl,
        faceRegisteredAt: new Date()
      });

      faceResult = {
        message: 'Face registered successfully (Local Fallback)',
        samplesProcessed: imageBuffers.length,
        mocked: true
      };
    }

    const user = await User.findById(userId).select('-password -faceEncoding -voiceEmbedding');

    res.json({
      success: true,
      message: faceResult.message,
      data: {
        user,
        samplesProcessed: faceResult.samplesProcessed || 1,
        mocked: faceResult.mocked || false
      },
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

    if (!voiceAudio) {
      return res.status(400).json({
        success: false,
        message: 'Voice audio is required',
      });
    }

    // Convert base64 to buffer (strip data URI prefix if present)
    const base64Data = voiceAudio.replace(/^data:audio\/[\w;]+,/, '');
    const audioBuffer = Buffer.from(base64Data, 'base64');

    // Prepare Cloudinary-compatible base64 string
    const audioDataUri = voiceAudio.startsWith('data:')
      ? voiceAudio
      : `data:audio/wav;base64,${base64Data}`;

    let voiceAudioUrl = 'https://via.placeholder.com/1?text=voice';
    let voiceEmbeddingData = null;
    let mocked = false;

    // Step 1: Try uploading to Cloudinary
    try {
      const cloudinaryResult = await uploadToCloudinary(
        audioDataUri,
        CLOUDINARY_FOLDERS.VOICES,
        'video' // Cloudinary treats audio as video resource type
      );
      voiceAudioUrl = cloudinaryResult.url;
    } catch (cloudErr) {
      console.warn('⚠️ Cloudinary voice upload failed, using placeholder URL:', cloudErr.message);
    }

    // Step 2: Try Python voice recognition service
    try {
      const voiceResult = await registerVoice(userId.toString(), audioBuffer);
      voiceEmbeddingData = Buffer.from(JSON.stringify(voiceResult.embedding || []));
    } catch (serviceError) {
      console.warn('⚠️ Python voice service unavailable. Using mock embedding.');
      // Create a mock embedding so voice is considered "registered"
      voiceEmbeddingData = Buffer.alloc(128 * 8); // 128 float64 values
      mocked = true;
    }

    // Step 3: Save to DB
    const user = await User.findByIdAndUpdate(
      userId,
      {
        voiceEmbedding: voiceEmbeddingData,
        voiceAudioUrl,
        voiceRegisteredAt: new Date(),
      },
      { new: true }
    ).select('-password -faceEncoding -voiceEmbedding');

    res.json({
      success: true,
      message: mocked
        ? 'Voice registered successfully (AI service offline – fallback mode)'
        : 'Voice registered successfully',
      data: { user, mocked },
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
    const { userId, voiceAudio, expectedText } = req.body;
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
    const verificationResult = await verifyVoice(targetUserId.toString(), audioBuffer, expectedText);

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

const { generateVerificationSentence } = require('../utils/sentenceGenerator');

/**
 * Get dynamic verification sentence for teacher voice verification
 * GET /api/biometric/voice/sentence
 */
const getVoiceSentence = async (req, res, next) => {
  try {
    const sentence = generateVerificationSentence();
    res.json({
      success: true,
      data: { sentence },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUserFace,
  verifyUserFace,
  registerUserVoice,
  verifyUserVoice,
  getVoiceSentence,
};
