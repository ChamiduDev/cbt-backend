const express = require('express');
const router = express.Router();
const { register, login, getMe, forgotPassword, verifyResetCode, resetPassword, verify } = require('../controllers/authController');
const auth = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);
router.get('/me', auth, getMe);
router.post('/forgotpassword', forgotPassword);
router.post('/verify-reset-code', verifyResetCode);
router.put('/resetpassword', auth, resetPassword);
router.get('/verify', verify);

module.exports = router;