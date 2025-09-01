const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');

exports.register = async (req, res) => {
  try {
    const { role, fullName, hotelName, address, city_id, sub_area_id, phone, secondaryPhone, username, email, password, vehicles } = req.body;

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    user = new User({
      role,
      fullName,
      hotelName,
      address,
      city_id,
      sub_area_id,
      phone,
      secondaryPhone,
      username,
      email,
      password,
      vehicles,
      userStatus: 'pending', // New users are pending by default
    });

    await user.save();

    res.json({ msg: 'Registration successful. Please wait for admin approval.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Backend Login: Received email:', email);

    let user = await User.findOne({ email });
    if (!user) {
      console.log('Backend Login: User not found for email:', email);
      return res.status(400).json({ msg: 'Invalid credentials' });
    }
    console.log('Backend Login: User found:', user.email);

    if (user.userStatus === 'rejected') {
      console.log('Backend Login: User rejected:', user.email);
      return res.status(401).json({ msg: 'Your account has been suspended. Please contact the admin for more details.' });
    }
    if (user.userStatus !== 'approved') {
      console.log('Backend Login: User not approved:', user.email);
      return res.status(401).json({ msg: 'Account not approved by admin' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Backend Login: Password mismatch for user:', user.email);
      return res.status(400).json({ msg: 'Invalid credentials' });
    }
    console.log('Backend Login: Password matched for user:', user.email);

    console.log('Backend Login: isAdmin status for user', user.email, ':', user.isAdmin);

    const payload = {
      user: {
        id: user.id,
        isAdmin: user.isAdmin,
        userStatus: user.userStatus,
        role: user.role
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token, isAdmin: user.isAdmin });
      }
    );

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const resetCode = user.getResetPasswordCode();
    await user.save({ validateBeforeSave: false });

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Your password reset code is: ${resetCode}. This code is valid for 10 minutes.`

    try {
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Code',
        message,
      });

      res.status(200).json({ success: true, data: 'Email sent with reset code' });
    } catch (err) {
      console.error(err);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ msg: 'Email could not be sent' });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.verifyResetCode = async (req, res) => {
  const { email, code } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const hashedCode = crypto.createHash('sha256').update(code).digest('hex');

    if (hashedCode !== user.resetPasswordToken || user.resetPasswordExpire < Date.now()) {
      return res.status(400).json({ msg: 'Invalid or expired code' });
    }

    // Clear the reset token fields after successful verification
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });

    // Generate a temporary JWT for password reset authorization
    const payload = {
      user: {
        id: user.id,
      },
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '5m' }, // Token valid for 5 minutes for password reset
      (err, token) => {
        if (err) throw err;
        res.json({ success: true, resetToken: token });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.resetPassword = async (req, res) => {
  // This function will now expect a JWT in the header, not a token in the URL
  // The user ID will be extracted from the JWT by the auth middleware
  const { password } = req.body;

  try {
    // req.user.id comes from the auth middleware after verifying the JWT
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    user.password = password;
    await user.save();

    res.status(200).json({ success: true, data: 'Password Reset Success' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.verify = async (req, res) => {
  try {
    const token = req.header('x-auth-token');
    if (!token) {
      return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.user;
    res.json({ isAdmin: req.user.isAdmin, userStatus: req.user.userStatus });

  } catch (err) {
    res.status(401).json({ msg: 'Token is not valid' });
  }
};

