const User = require('../models/User');
const VehicleStatus = require('../models/VehicleStatus');
const City = require('../models/City');

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'admin' } }); // Exclude admin user
    res.json(users);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    user.approved = true;
    await user.save();
    res.json({ msg: 'User approved' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.blockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    user.approved = false;
    await user.save();
    res.json({ msg: 'User blocked' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.rejectUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    user.userStatus = 'rejected';
    await user.save();
    res.json({ msg: 'User rejected and suspended', user });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.getVehicleStatusCounts = async (req, res) => {
  try {
    const waitingCount = await VehicleStatus.countDocuments({ status: 'waiting' });
    const onTheWayCount = await VehicleStatus.countDocuments({ status: 'on_the_way' });
    const notAvailableCount = await VehicleStatus.countDocuments({ status: 'not_available' });

    res.json({
      waiting: waitingCount,
      onTheWay: onTheWayCount,
      notAvailable: notAvailableCount,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

exports.getAllVehicleStatuses = async (req, res) => {
  try {
    const vehicleStatuses = await VehicleStatus.find()
      .populate({
        path: 'user',
        select: 'name email vehicles',
      })
      .populate('city_id', 'name')
      .populate('sub_area_id', 'name');

    // Process vehicle statuses to handle fromLocation and toLocation conversion
    const processedStatuses = [];
    
    for (let status of vehicleStatuses) {
      if (status.user && status.user.vehicles && status.user.vehicles[status.vehicleIndex]) {
        const vehicle = status.user.vehicles[status.vehicleIndex];
        
        let processedStatus = {
          _id: status._id,
          status: status.status,
          fromLocation: status.fromLocation,
          toLocation: status.toLocation,
          city_id: status.city_id,
          sub_area_id: status.sub_area_id,
          user: {
            _id: status.user._id,
            name: status.user.fullName,
          },
          vehicle: {
            vehicleNumber: vehicle.number,
            vehicleName: vehicle.model,
          },
        };

        // Handle fromLocation and toLocation conversion for on_the_way status
        if (status.status === 'on_the_way') {
          // Handle fromLocation
          if (status.fromLocation && typeof status.fromLocation === 'string') {
            try {
              const fromCity = await City.findById(status.fromLocation);
              if (fromCity) {
                processedStatus.fromLocation = { _id: fromCity._id, name: fromCity.name };
              } else {
                // If city not found, keep the original ID but add a note
                processedStatus.fromLocation = { _id: status.fromLocation, name: 'Unknown City' };
              }
            } catch (err) {
              console.error('Error fetching fromLocation city:', err);
              // Keep the original ID if there's an error
              processedStatus.fromLocation = { _id: status.fromLocation, name: 'Error Loading City' };
            }
          }

          // Handle toLocation
          if (status.toLocation && typeof status.toLocation === 'string') {
            try {
              const toCity = await City.findById(status.toLocation);
              if (toCity) {
                processedStatus.toLocation = { _id: toCity._id, name: toCity.name };
              } else {
                // If city not found, keep the original ID but add a note
                processedStatus.toLocation = { _id: status.toLocation, name: 'Unknown City' };
              }
            } catch (err) {
              console.error('Error fetching toLocation city:', err);
              // Keep the original ID if there's an error
              processedStatus.toLocation = { _id: status.toLocation, name: 'Error Loading City' };
            }
          }
        }

        processedStatuses.push(processedStatus);
      }
    }

    res.json(processedStatuses);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};