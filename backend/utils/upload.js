const multer = require('multer');
const path = require('path');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter function
const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedImageTypes = /jpeg|jpg|png|gif/;
  const allowedAudioTypes = /mp3|wav|webm|ogg|m4a/;
  
  const extname = path.extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype;

  // Check if it's an image
  if (file.fieldname === 'face' || file.fieldname === 'image') {
    const isValidImage = allowedImageTypes.test(extname) && mimetype.startsWith('image/');
    if (isValidImage) {
      return cb(null, true);
    }
  }

  // Check if it's audio
  if (file.fieldname === 'voice' || file.fieldname === 'audio') {
    const isValidAudio = allowedAudioTypes.test(extname) && mimetype.startsWith('audio/');
    if (isValidAudio) {
      return cb(null, true);
    }
  }

  cb(new Error('Invalid file type. Only images (JPEG, PNG, GIF) and audio (MP3, WAV, WebM) are allowed.'));
};

// Create multer upload middleware
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
  },
  fileFilter: fileFilter,
});

/**
 * Convert buffer to base64 data URL
 * @param {Buffer} buffer - File buffer
 * @param {string} mimetype - MIME type
 * @returns {string} Base64 data URL
 */
const bufferToDataURL = (buffer, mimetype) => {
  const base64 = buffer.toString('base64');
  return `data:${mimetype};base64,${base64}`;
};

/**
 * Convert base64 to buffer
 * @param {string} base64String - Base64 string
 * @returns {Buffer} File buffer
 */
const base64ToBuffer = (base64String) => {
  // Remove data URL prefix if present
  const base64Data = base64String.replace(/^data:.*?;base64,/, '');
  return Buffer.from(base64Data, 'base64');
};

module.exports = {
  upload,
  bufferToDataURL,
  base64ToBuffer,
};
