const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const User = require('../models/User');
const AppCommission = require('../models/AppCommission');
const Bid = require('../models/Bid');

// @route    POST api/bookings
// @desc     Create a new booking
// @access   Private (Hotel/Broker/Admin)
exports.createBooking = async (req, res) => {
  const { pickupLocation, destinationLocation, pickupDate, pickupTime, riderAmount, commission, phoneNumber, numberOfGuests, vehicleType } = req.body;

  try {
    // Ensure the user making the request is authenticated
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const totalAmount = riderAmount + commission;

    const newBooking = new Booking({
      user: req.user.id,
      pickupLocation,
      destinationLocation,
      pickupDate,
      pickupTime,
      riderAmount,
      commission,
      totalAmount,
      phoneNumber: phoneNumber || user.phone,
      numberOfGuests,
      vehicleType,
    });

    const booking = await newBooking.save();
    req.io.emit('newBooking', booking);
    res.status(201).json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    GET api/bookings
// @desc     Get all bookings (Admin only) or user's bookings (Hotel/Broker/Rider)
// @access   Private
exports.getBookings = async (req, res) => {
  try {
    const appCommission = await AppCommission.findOne();

    let bookings;
    console.log('getBookings: User role:', req.user.role);
    console.log('getBookings: User isAdmin:', req.user.isAdmin);

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (req.user.isAdmin || req.user.role === 'ride') {
      // Admin and Rider can see all bookings
      bookings = await Booking.find({ pickupDate: { $gte: now } })
        .populate('user', 'fullName email role')
        .populate('pickupLocation.city_id', 'name')
        .populate('pickupLocation.sub_area_id', 'name')
        .populate('destinationLocation.city_id', 'name')
        .populate('destinationLocation.sub_area_id', 'name')
        .populate('rider', 'fullName')
        .sort({ createdAt: -1 });
    } else {
      // Other regular users (hotel, broker) can only see their own bookings
      bookings = await Booking.find({ user: req.user.id, pickupDate: { $gte: now } })
        .populate('user', 'fullName email role')
        .populate('pickupLocation.city_id', 'name')
        .populate('pickupLocation.sub_area_id', 'name')
        .populate('destinationLocation.city_id', 'name')
        .populate('destinationLocation.sub_area_id', 'name')
        .populate('rider', 'fullName')
        .sort({ createdAt: -1 });
    }

    const bookingsWithRideCost = await Promise.all(bookings.map(async booking => {
      let totalIncome = booking.totalAmount;
      let appCommissionValue = 0;
      let appCommissionType = 'fixed';
      if (appCommission) {
        appCommissionValue = appCommission.value;
        appCommissionType = appCommission.type;
        if (appCommission.type === 'percentage') {
          totalIncome = booking.totalAmount * (1 - appCommission.value / 100);
        } else {
          totalIncome = booking.totalAmount - appCommission.value;
        }
      }
      totalIncome = totalIncome - booking.commission;

      // Fetch bids for this booking
      let bids = [];
      if (req.user.role === 'ride') {
        bids = await Bid.find({ booking: booking._id, rider: req.user.id }).populate('rider', 'fullName email');
      } else {
        bids = await Bid.find({ booking: booking._id }).populate('rider', 'fullName email');
      }

      return {
        ...booking.toObject(),
        totalIncome,
        appCommissionValue,
        appCommissionType,
        bids, // Add bids to the booking object
      };
    }));

    console.log('getBookings: Found bookings:', bookings.length);
    res.json(bookingsWithRideCost);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    PUT api/bookings/:id/status
// @desc     Update booking status (Admin only)
// @access   Private (Admin)
exports.updateBookingStatus = async (req, res) => {
  const { status } = req.body;

  try {
    let booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (req.user.isAdmin) {
      booking.status = status;
      await booking.save();
      res.json(booking);
    } else {
      return res.status(403).json({ msg: 'Not authorized to update booking status' });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    PUT api/bookings/:id/accept
// @desc     Accept a booking (Rider)
// @access   Private (Rider)
exports.acceptBooking = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ msg: 'Invalid booking ID' });
    }
    let booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Check if rider already has a bid for this booking
    const existingBid = await Bid.findOne({
      booking: booking._id,
      rider: req.user.id
    });

    if (existingBid) {
      return res.status(400).json({ msg: 'You already have a bid for this booking' });
    }

    const appCommission = await AppCommission.findOne();
    if (!appCommission) {
      return res.status(404).json({ msg: 'App commission not found' });
    }

    // Calculate rider income based on total amount and commission
    let riderIncome = booking.totalAmount;
    if (appCommission.type === 'percentage') {
      riderIncome = booking.totalAmount * (1 - appCommission.value / 100);
    } else {
      riderIncome = booking.totalAmount - appCommission.value;
    }
    riderIncome = riderIncome - booking.commission;

    // Get the rider's first vehicle as default (or require vehicle selection)
    const rider = await User.findById(req.user.id).populate('vehicles');
    if (!rider || !rider.vehicles || rider.vehicles.length === 0) {
      return res.status(400).json({ msg: 'No vehicles found for rider' });
    }

    // Create a bid with the original booking amount and selected vehicle
    const newBid = new Bid({
      booking: booking._id,
      rider: req.user.id,
      bidAmount: booking.totalAmount,
      commissionRate: appCommission.value,
      riderIncome,
      selectedVehicle: rider.vehicles[0], // Use first vehicle as default
      status: 'pending_confirmation' // Mark as pending confirmation so hotel can confirm
    });

    await newBid.save();
    
    // Update booking status based on current status
    if (booking.status === 'pending') {
      booking.status = 'pending_confirmation';
    } else if (booking.status === 'bid_placed') {
      // If there are already bids, keep status as bid_placed
      // The pending_confirmation bid will be handled by the hotel
    }
    
    await booking.save();

    req.io.emit('newBid', newBid);
    res.json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    DELETE api/bookings/:id
// @desc     Delete a booking (Admin only)
// @access   Private (Admin)
exports.deleteBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (req.user.isAdmin) {
      await Booking.findByIdAndDelete(req.params.id);
      res.json({ msg: 'Booking removed' });
    } else {
      return res.status(403).json({ msg: 'Not authorized to delete booking' });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    PUT api/bookings/:id/cancel
// @desc     Cancel a booking
// @access   Private
exports.cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Check if the user is authorized to cancel the booking
    if (booking.user.toString() !== req.user.id && booking.rider.toString() !== req.user.id && !req.user.isAdmin) {
      return res.status(401).json({ msg: 'User not authorized' });
    }

    booking.status = 'cancelled';
    await booking.save();

    req.io.emit('bookingCancelled', { bookingId: req.params.id });

    res.json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    PUT api/bookings/:id/reject
// @desc     Reject a ride (Rider)
// @access   Private (Rider)
exports.rejectRide = async (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason || reason.trim() === '') {
      return res.status(400).json({ msg: 'Rejection reason is required' });
    }

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Check if the user is the assigned rider for this booking
    if (booking.rider.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Only the assigned rider can reject this ride' });
    }

    // Check if the booking is in a state that can be rejected
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ msg: 'Only confirmed rides can be rejected' });
    }

    // Update booking status to bid_placed (so hotels can select another rider) and add rejection details
    booking.status = 'bid_placed';
    booking.rejectionReason = reason;
    booking.rejectedAt = new Date();
    booking.rejectedBy = req.user.id;

    // Also update the bid status from 'accepted' to 'rejected'
    if (booking.confirmedBid) {
      const bid = await Bid.findById(booking.confirmedBid);
      if (bid) {
        bid.status = 'rejected';
        bid.rejectionReason = reason;
        await bid.save();
      }
    }

    // Clear the confirmed rider and bid so another rider can be selected
    booking.rider = undefined;
    booking.confirmedBid = undefined;

    await booking.save();

    // Emit socket event for real-time updates
    req.io.emit('rideRejected', { 
      bookingId: req.params.id, 
      reason: reason,
      riderId: req.user.id 
    });

    res.json(booking);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    PUT api/bookings/:id/start
// @desc     Start a ride (Rider)
// @access   Private (Rider)
exports.startRide = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('pickupLocation.city_id', 'name _id')
      .populate('destinationLocation.city_id', 'name _id');

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Check if the user is the assigned rider for this booking
    if (booking.rider.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Only the assigned rider can start this ride' });
    }

    // Check if the booking is in a state that can be started
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ msg: 'Only confirmed rides can be started' });
    }

    // Update booking status to 'in_progress'
    booking.status = 'in_progress';
    booking.startedAt = new Date();
    booking.startedBy = req.user.id;

    await booking.save();

    // Emit socket event for real-time updates
    req.io.emit('rideStarted', {
      bookingId: req.params.id,
      riderId: req.user.id,
      startedAt: booking.startedAt
    });

    res.json({
      msg: 'Ride started successfully',
      booking: booking,
      vehicleUpdateRequired: true,
      fromLocation: booking.pickupLocation.city_id,
      toLocation: booking.destinationLocation.city_id
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    PUT api/bookings/:id/finish
// @desc     Finish a ride (Rider)
// @access   Private (Rider)
exports.finishRide = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('pickupLocation.city_id', 'name _id')
      .populate('destinationLocation.city_id', 'name _id');

    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Check if the user is the assigned rider for this booking
    if (booking.rider.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Only the assigned rider can finish this ride' });
    }

    // Check if the booking is in a state that can be finished
    if (booking.status !== 'in_progress') {
      return res.status(400).json({ msg: 'Only in-progress rides can be finished' });
    }

    // Update booking status to 'completed'
    booking.status = 'completed';
    booking.completedAt = new Date();
    booking.completedBy = req.user.id;

    await booking.save();

    // Emit socket event for real-time updates
    req.io.emit('rideCompleted', {
      bookingId: req.params.id,
      riderId: req.user.id,
      completedAt: booking.completedAt
    });

    res.json({
      msg: 'Ride completed successfully',
      booking: booking
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

// @route    GET api/bookings/history
// @desc     Get ride history for riders (completed rides)
// @access   Private (Rider only)
exports.getRideHistory = async (req, res) => {
  try {
    // Check if user is a rider
    if (req.user.role !== 'ride') {
      return res.status(403).json({ msg: 'Access denied. Only riders can view ride history.' });
    }

    // Get all completed rides for the current rider
    const completedRides = await Booking.find({
      status: 'completed',
      rider: req.user.id
    })
      .populate('user', 'fullName email role')
      .populate('pickupLocation.city_id', 'name')
      .populate('pickupLocation.sub_area_id', 'name')
      .populate('destinationLocation.city_id', 'name')
      .populate('destinationLocation.sub_area_id', 'name')
      .populate('rider', 'fullName')
      .sort({ completedAt: -1 }); // Sort by completion date, most recent first

    console.log(`getRideHistory: Found ${completedRides.length} completed rides for rider ${req.user.id}`);

    // Add additional computed fields for the frontend
    const ridesWithDetails = completedRides.map(ride => ({
      ...ride.toObject(),
      rideDuration: ride.completedAt && ride.startedAt 
        ? Math.round((ride.completedAt - ride.startedAt) / (1000 * 60)) // Duration in minutes
        : null,
      daysAgo: ride.completedAt 
        ? Math.floor((Date.now() - ride.completedAt) / (1000 * 60 * 60 * 24)) // Days since completion
        : null
    }));

    res.json(ridesWithDetails);
  } catch (err) {
    console.error('getRideHistory error:', err.message);
    res.status(500).send('Server Error');
  }
};

// @route    GET api/bookings/finished
// @desc     Get all finished rides (Admin only)
// @access   Private (Admin only)
exports.getFinishedRides = async (req, res) => {
  try {
    // Get all completed and cancelled rides
    const finishedRides = await Booking.find({
      status: { $in: ['completed', 'cancelled'] }
    })
      .populate('user', 'fullName email phone')
      .populate('pickupLocation.city_id', 'name')
      .populate('pickupLocation.sub_area_id', 'name')
      .populate('destinationLocation.city_id', 'name')
      .populate('destinationLocation.sub_area_id', 'name')
      .populate('rider', 'fullName email phone')
      .sort({ completedAt: -1, createdAt: -1 });

    console.log(`getFinishedRides: Found ${finishedRides.length} finished rides`);

    // Add computed fields
    const ridesWithDetails = finishedRides.map(ride => ({
      ...ride.toObject(),
      rideDuration: ride.completedAt && ride.startedAt 
        ? Math.round((ride.completedAt - ride.startedAt) / (1000 * 60))
        : null,
      daysAgo: ride.completedAt 
        ? Math.floor((Date.now() - ride.completedAt) / (1000 * 60 * 60 * 24))
        : ride.createdAt 
          ? Math.floor((Date.now() - ride.createdAt) / (1000 * 60 * 60 * 24))
          : null
    }));

    res.json(ridesWithDetails);
  } catch (err) {
    console.error('getFinishedRides error:', err.message);
    res.status(500).send('Server Error');
  }
};

// @route    GET api/bookings/on-the-way
// @desc     Get all on-the-way rides (Admin only)
// @access   Private (Admin only)
exports.getOnTheWayRides = async (req, res) => {
  try {
    // Get all active rides (accepted, on_the_way, arrived, in_progress)
    const onTheWayRides = await Booking.find({
      status: { $in: ['accepted', 'on_the_way', 'arrived', 'in_progress'] }
    })
      .populate('user', 'fullName email phone')
      .populate('pickupLocation.city_id', 'name')
      .populate('pickupLocation.sub_area_id', 'name')
      .populate('destinationLocation.city_id', 'name')
      .populate('destinationLocation.sub_area_id', 'name')
      .populate('rider', 'fullName email phone')
      .sort({ createdAt: -1 });

    console.log(`getOnTheWayRides: Found ${onTheWayRides.length} active rides`);

    // Add computed fields
    const ridesWithDetails = onTheWayRides.map(ride => ({
      ...ride.toObject(),
      timeSinceStarted: ride.startedAt 
        ? Math.floor((Date.now() - ride.startedAt) / (1000 * 60)) // Minutes since started
        : null
    }));

    res.json(ridesWithDetails);
  } catch (err) {
    console.error('getOnTheWayRides error:', err.message);
    res.status(500).send('Server Error');
  }
};
