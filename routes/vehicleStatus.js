const express = require('express');
const router = express.Router();
const {
  getVehicleStatuses,
  setVehicleStatus,
  clearVehicleStatus,
  getVehicleStatusByIndex,
} = require('../controllers/vehicleStatusController');
const auth = require('../middleware/authMiddleware');

// All other routes require authentication
router.use(auth);

// Get all vehicle statuses for the authenticated user
router.get('/', getVehicleStatuses);

// Set vehicle status
router.post('/', setVehicleStatus);

// Get vehicle status by index
router.get('/:vehicleIndex', getVehicleStatusByIndex);

// Clear vehicle status
router.delete('/:vehicleIndex', clearVehicleStatus);

module.exports = router;