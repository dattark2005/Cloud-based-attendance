const User = require('../models/User');
const { uploadToCloudinary } = require('../config/cloudinary');
const { registerFace, batchRegisterFace, verifyFace, registerVoice, verifyVoice } = require('../utils/apiClient');
const { ROLES, CLOUDINARY_FOLDERS } = require('../config/constants');
const { compareFaceImages } = require('../utils/faceComparison');

/* ─────────────────────────────────────────────────────────────────
 *  FACE REGISTRATION
 *  POST /api/biometric/face/register  (also used via teacherAttendance/register-face)
 *
 *  What is saved to MongoDB:
 *    faceEncoding     → serialised numpy vector from Python (if service is up)
 *    faceImageData    → raw JPEG bytes of the registered image (always saved)
 *    faceImageUrl     → Cloudinary public URL
 *    faceRegisteredAt → timestamp
 * ───────────────────────────────────────────────────────────────── */
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

    // Strip potential data-URL prefix and decode to Buffer
    const imageBuffers = imagesToProcess.map(img =>
      Buffer.from(img.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    );

    // The primary image used for storage (first one)
    const primaryBuffer = imageBuffers[0];
    const primaryBase64 = imagesToProcess[0].startsWith('data:')
      ? imagesToProcess[0]
      : `data:image/jpeg;base64,${imagesToProcess[0]}`;

    // ── 1. Try Python face recognition service ──
    let faceEncoding = null;
    let usedMock = false;

    try {
      let faceResult;
      if (imageBuffers.length > 1) {
        faceResult = await batchRegisterFace(userId.toString(), imageBuffers);
      } else {
        faceResult = await registerFace(userId.toString(), imageBuffers[0]);
      }

      // Python returned an encoding — store it
      if (faceResult.encoding) {
        faceEncoding = Buffer.from(JSON.stringify(faceResult.encoding));
      } else {
        // No encoding returned but no error — use a marker
        faceEncoding = Buffer.from('python_registered');
      }

      console.log('✅ Python face service: face registered successfully');
    } catch (serviceError) {
      console.warn('⚠️  Python AI service unavailable. Using local registration fallback.');
      // Fallback encoding — a fixed marker so we know it was registered locally
      faceEncoding = Buffer.from('local_registered');
      usedMock = true;
    }

    // ── 2. Upload to Cloudinary (best-effort) ──
    let imageUrl = null;
    try {
      const cloudinaryResult = await uploadToCloudinary(primaryBase64, CLOUDINARY_FOLDERS.FACES);
      imageUrl = cloudinaryResult.url;
      console.log('✅ Face image uploaded to Cloudinary:', imageUrl);
    } catch (cloudErr) {
      console.warn('⚠️  Cloudinary upload failed, face stored locally only:', cloudErr.message);
    }

    // ── 3. Save to MongoDB — ALWAYS save the raw image bytes ──
    await User.findByIdAndUpdate(userId, {
      faceEncoding,               // Python encoding or marker
      faceImageData: primaryBuffer, // ← Raw JPEG bytes for local comparison
      faceImageUrl: imageUrl,     // Cloudinary URL (may be null)
      faceRegisteredAt: new Date(),
    });

    console.log(`✅ Face registration saved to DB for user ${userId} (mock=${usedMock})`);

    const user = await User.findById(userId).select('-password -faceEncoding -faceImageData -voiceEmbedding');

    res.json({
      success: true,
      message: usedMock
        ? 'Face registered successfully (AI service offline — using local comparison)'
        : 'Face registered successfully',
      data: {
        user,
        samplesProcessed: imagesToProcess.length,
        mocked: usedMock,
      },
    });
  } catch (error) {
    console.error('Face registration error:', error);
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────────────
 *  FACE VERIFICATION
 *  POST /api/biometric/face/verify
 *
 *  Flow:
 *    1. Check user has a registered face (faceEncoding or faceImageData)
 *    2. Try Python service first
 *    3. If Python unavailable → compare raw image bytes via faceComparison
 *    4. If comparison says NO MATCH → reject with clear error
 *    5. If no registered image bytes either → reject (can't verify)
 * ───────────────────────────────────────────────────────────────── */
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

    // Fetch user — include faceEncoding and faceImageData for comparison
    const user = await User.findById(targetUserId).select('+faceEncoding +faceImageData');

    if (!user || (!user.faceEncoding && !user.faceImageData)) {
      return res.status(400).json({
        success: false,
        message: 'Face not registered. Please register your face first.',
      });
    }

    const scanBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    // ── 1. Try Python face recognition service ──
    try {
      const verificationResult = await verifyFace(targetUserId.toString(), scanBuffer);

      if (!verificationResult.verified) {
        console.warn(`❌ Python service: face rejected for user ${targetUserId} (confidence=${verificationResult.confidence})`);
        return res.status(401).json({
          success: false,
          message: '❌ Invalid face – face not recognised. Please try again.',
          data: { verified: false, confidence: verificationResult.confidence },
        });
      }

      console.log(`✅ Python service: face verified for user ${targetUserId}`);
      return res.json({
        success: true,
        message: 'Face verified successfully',
        data: {
          verified: true,
          confidence: verificationResult.confidence,
          method: 'python_ai',
        },
      });
    } catch (serviceError) {
      // Python unavailable — fall through to local comparison
      console.warn('⚠️  Python face service unavailable. Falling back to local image comparison.');
    }

    // ── 2. Local image comparison fallback ──
    if (!user.faceImageData || user.faceImageData.length === 0) {
      // Registered via Python but Python is now down — we have no local data to compare against
      return res.status(503).json({
        success: false,
        message: 'Face recognition service is currently unavailable. Please try again later.',
        data: { verified: false },
      });
    }

    const { matched, confidence } = compareFaceImages(user.faceImageData, scanBuffer);

    if (!matched) {
      console.warn(`❌ Local comparison: face rejected for user ${targetUserId} (confidence=${confidence.toFixed(2)})`);
      return res.status(401).json({
        success: false,
        message: '❌ Invalid face – face not recognised. Please try again.',
        data: { verified: false, confidence, method: 'local_comparison' },
      });
    }

    console.log(`✅ Local comparison: face verified for user ${targetUserId} (confidence=${confidence.toFixed(2)})`);
    return res.json({
      success: true,
      message: 'Face verified successfully (local comparison)',
      data: {
        verified: true,
        confidence,
        method: 'local_comparison',
      },
    });
  } catch (error) {
    console.error('Face verification error:', error);
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────────────
 *  VOICE REGISTRATION
 *  POST /api/biometric/voice/register  (teachers/admins only)
 * ───────────────────────────────────────────────────────────────── */
const registerUserVoice = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { voiceAudio } = req.body;

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

    const audioBuffer = Buffer.from(voiceAudio.replace(/^data:audio\/\w+;base64,/, ''), 'base64');

    let audioUrl = null;
    let voiceEmbedding;

    try {
      const voiceResult = await registerVoice(userId.toString(), audioBuffer);
      voiceEmbedding = Buffer.from(JSON.stringify(voiceResult.embedding));
    } catch (serviceError) {
      console.warn('⚠️ Voice service unavailable. Using mock voice registration.');
      voiceEmbedding = Buffer.alloc(256 * 8);
    }

    try {
      const cloudinaryResult = await uploadToCloudinary(
        `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
        CLOUDINARY_FOLDERS.VOICES,
        'video'
      );
      audioUrl = cloudinaryResult.url;
    } catch (cloudErr) {
      console.warn('⚠️ Cloudinary upload failed for voice:', cloudErr.message);
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { voiceEmbedding, voiceAudioUrl: audioUrl, voiceRegisteredAt: new Date() },
      { new: true }
    ).select('-password -faceEncoding -faceImageData -voiceEmbedding');

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

/* ─────────────────────────────────────────────────────────────────
 *  VOICE VERIFICATION
 *  POST /api/biometric/voice/verify
 * ───────────────────────────────────────────────────────────────── */
const verifyUserVoice = async (req, res, next) => {
  try {
    const { userId, voiceAudio, expectedText } = req.body;
    const targetUserId = userId || req.user._id;

    if (!voiceAudio) {
      return res.status(400).json({ success: false, message: 'Voice audio is required' });
    }

    const user = await User.findById(targetUserId);
    if (!user || !user.voiceEmbedding) {
      return res.status(400).json({
        success: false,
        message: 'Voice not registered. Please register your voice first.',
      });
    }

    const audioBuffer = Buffer.from(voiceAudio.replace(/^data:audio\/\w+;base64,/, ''), 'base64');

    try {
      const verificationResult = await verifyVoice(targetUserId.toString(), audioBuffer, expectedText);
      res.json({
        success: true,
        message: verificationResult.verified ? 'Voice verified successfully' : 'Voice verification failed',
        data: {
          verified: verificationResult.verified,
          confidence: verificationResult.confidence,
        },
      });
    } catch (serviceError) {
      return res.status(503).json({
        success: false,
        message: 'Voice recognition service is currently unavailable.',
        data: { verified: false },
      });
    }
  } catch (error) {
    console.error('Voice verification error:', error);
    next(error);
  }
};

/* ─────────────────────────────────────────────────────────────────
 *  VOICE SENTENCE
 *  GET /api/biometric/voice/sentence
 * ───────────────────────────────────────────────────────────────── */
const { generateVerificationSentence } = require('../utils/sentenceGenerator');

const getVoiceSentence = async (req, res, next) => {
  try {
    const sentence = generateVerificationSentence();
    res.json({ success: true, data: { sentence } });
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
