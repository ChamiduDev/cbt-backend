const express = require('express');
const router = express.Router();
const { getAllUsers, approveUser, blockUser, rejectUser, getVehicleStatusCounts, getAllVehicleStatuses } = require('../controllers/adminController');
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware');

router.get('/users', auth, admin, getAllUsers);
router.put('/approve-user/:userId', auth, admin, approveUser);
router.put('/block-user/:userId', auth, admin, blockUser);
router.delete('/reject-user/:userId', auth, admin, rejectUser);

// Vehicle Status Routes
router.get('/vehicle-status/counts', auth, admin, getVehicleStatusCounts);
router.get('/vehicle-status', auth, admin, getAllVehicleStatuses);

module.exports = router;