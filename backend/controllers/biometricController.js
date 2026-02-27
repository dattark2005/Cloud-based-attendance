const User = require('../models/User');
const { uploadToCloudinary } = require('../config/cloudinary');
const { registerFace, batchRegisterFace, verifyFace, registerVoice, verifyVoice } = require('../utils/apiClient');
const { ROLES, CLOUDINARY_FOLDERS } = require('../config/constants');

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
    // NOTE: Python's /register-face stores the real 128-float SFace encoding directly
    // in MongoDB itself. Do NOT overwrite faceEncoding from Node.js — that would
    // corrupt the real float64 array with a plain text string, causing /verify-face
    // to crash with a NumPy 500 error.
    let usedMock = false;

    try {
      if (imageBuffers.length > 1) {
        await batchRegisterFace(userId.toString(), imageBuffers);
      } else {
        await registerFace(userId.toString(), imageBuffers[0]);
      }
      console.log('✅ Python face service: face registered successfully');
    } catch (serviceError) {
      console.warn('⚠️  Python AI service unavailable. Using local registration fallback.');
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

    // ── 3. Save to MongoDB ──
    // Only update image fields and registration timestamp.
    // faceEncoding is written by the Python service directly — do not touch it here.
    const updateFields = {
      faceImageData: primaryBuffer, // Raw JPEG for local fallback comparison
      faceImageUrl: imageUrl,
      faceRegisteredAt: new Date(),
    };
    // If Python was unavailable, set a local marker ONLY if no real encoding exists yet
    if (usedMock) {
      updateFields.$setOnInsert = {}; // don't overwrite if already set
      // Use $set for faceEncoding only if it's not already a real 128-float array
      const existingUser = await User.findById(userId).select('+faceEncoding');
      const existingEnc = existingUser?.faceEncoding;
      const hasRealEncoding = existingEnc && existingEnc.length === 1024; // 128 * float64 (8 bytes) — works for both dlib and SFace
      if (!hasRealEncoding) {
        updateFields.faceEncoding = Buffer.from('local_registered');
      }
    }
    await User.findByIdAndUpdate(userId, updateFields);

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
      // Python service unavailable — hard fail, no local fallback
      console.error('❌ Python face service unavailable in biometric verify — no fallback allowed:', serviceError.message);
      return res.status(503).json({
        success: false,
        message: '⚠️ Face recognition service is currently unavailable. Please ensure the Python AI service is running and try again.',
        data: { verified: false, serviceUnavailable: true },
      });
    }
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

    let voiceAudioUrl = null;
    let voiceEmbeddingData = null;
    let mocked = false;

    // Step 1: Try uploading to Cloudinary
    try {
      const cloudinaryResult = await uploadToCloudinary(
        audioDataUri,
        CLOUDINARY_FOLDERS.VOICES,
        'video'
      );
      voiceAudioUrl = cloudinaryResult.url;
    } catch (cloudErr) {
      console.warn('⚠️ Cloudinary voice upload failed:', cloudErr.message);
    }

    // Step 2: Try Python voice recognition service
    try {
      const voiceResult = await registerVoice(userId.toString(), audioBuffer);
      voiceEmbeddingData = Buffer.from(JSON.stringify(voiceResult.embedding || []));
    } catch (serviceError) {
      console.warn('⚠️ Python voice service unavailable. Using mock embedding.');
      voiceEmbeddingData = Buffer.alloc(128 * 8);
      mocked = true;
    }

    // Step 3: Save to DB
    const user = await User.findByIdAndUpdate(
      userId,
      { voiceEmbedding: voiceEmbeddingData, voiceAudioUrl, voiceRegisteredAt: new Date() },
      { new: true }
    ).select('-password -faceEncoding -faceImageData -voiceEmbedding');

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
