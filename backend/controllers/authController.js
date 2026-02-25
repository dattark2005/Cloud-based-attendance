const User = require('../models/User');
const { generateTokens } = require('../utils/jwt');
const { ROLES } = require('../config/constants');

/**
 * Register new user
 * POST /api/auth/register
 */
const register = async (req, res, next) => {
  try {
    const { email, password, fullName, role, department, prn, rollNumber } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
      });
    }

    // Create user
    const user = await User.create({
      email,
      password,
      fullName,
      role: role || ROLES.STUDENT,
      department,
      prn,
      rollNumber,
    });

    // Generate tokens
    const tokens = generateTokens(user);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
        ...tokens,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user and include password
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.',
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens
    const tokens = generateTokens(user);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          department: user.department,
          faceRegistered: !!user.faceEncoding,
          voiceRegistered: !!user.voiceEmbedding,
        },
        ...tokens,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user
 * GET /api/auth/me
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('department', 'name code')
      .select('-faceEncoding -voiceEmbedding');

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout user
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
  // In a stateless JWT system, logout is handled client-side
  // by removing the token. For additional security, you could
  // implement token blacklisting here.

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
};

/**
 * Refresh access token
 * POST /api/auth/refresh
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    // Verify refresh token
    const { verifyToken } = require('../utils/jwt');
    const decoded = verifyToken(refreshToken, true);

    // Get user
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    // Generate new tokens
    const tokens = generateTokens(user);

    res.json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    next(error);
  }
};

const axios = require('axios');

/**
 * Proxy image request to bypass CORS
 * GET /api/auth/proxy-image?url=
 */
const proxyImage = async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).send('URL is required');
    }

    const decodedUrl = decodeURIComponent(url);

    // If URL is a placeholder / mock image, return a transparent 1×1 PNG immediately
    // so the student face recognition can fail gracefully in the browser
    const PLACEHOLDER_PATTERNS = ['via.placeholder.com', 'placeholder.com', '?text=', 'placehold'];
    if (PLACEHOLDER_PATTERNS.some(p => decodedUrl.includes(p))) {
      // 1×1 transparent PNG (base64)
      const transparentPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      res.set('Content-Type', 'image/png');
      return res.send(transparentPng);
    }

    const response = await axios({
      method: 'get',
      url: decodedUrl,
      responseType: 'stream',
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy error:', error.message);
    // Return transparent 1×1 PNG instead of crashing — browser-safe fallback
    const transparentPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    res.set('Content-Type', 'image/png');
    res.send(transparentPng);
  }
};

/**
 * Update current user profile (name, department)
 * PATCH /api/auth/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { fullName, department } = req.body;
    const updates = {};
    if (fullName) updates.fullName = fullName.trim();
    if (department !== undefined) updates.department = department;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    )
      .populate('department', 'name code')
      .select('-faceEncoding -voiceEmbedding -password');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Change password for logged-in user (teacher or student)
 * POST /api/auth/change-password
 */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Both current and new password are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters',
      });
    }

    // Load user with password field
    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify current password
    const isValid = await user.comparePassword(currentPassword);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Update password — pre-save hook will hash it
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  logout,
  refreshToken,
  proxyImage,
  updateProfile,
  changePassword,
};
