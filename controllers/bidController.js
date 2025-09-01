const mongoose = require('mongoose');
const Bid = require('../models/Bid');
const Booking = require('../models/Booking');
const AppCommission = require('../models/AppCommission');
const RideLimit = require('../models/RideLimit');

exports.createBid = async (req, res) => {
  const { bookingId, bidAmount, selectedVehicle } = req.body;
  const riderId = req.user.id;

  try {
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ msg: 'Invalid booking ID' });
    }

    // Check ride limit before allowing bid
    const globalLimit = await RideLimit.getGlobalRideLimit();
    const eligibility = globalLimit.canTakeRideAction(riderId);
    
    if (!eligibility.canTakeAction) {
      return res.status(400).json({ 
        msg: eligibility.reason,
        remainingRides: eligibility.remainingRides,
        dailyLimit: globalLimit.dailyLimit
      });
    }
    const appCommission = await AppCommission.findOne();
    if (!appCommission) {
      return res.status(404).json({ msg: 'App commission not found' });
    }

    let commissionRate = 0;
    if (appCommission.type === 'percentage') {
      commissionRate = appCommission.value / 100;
    }

    const riderIncome = bidAmount * (1 - commissionRate);
    
    // Check if the rider already has a bid for this booking
    let bid = await Bid.findOne({
      booking: bookingId,
      rider: riderId
    });

    if (bid) {
      // Update existing bid
      bid.bidAmount = bidAmount;
      bid.commissionRate = appCommission.value;
      bid.riderIncome = riderIncome;
      bid.selectedVehicle = selectedVehicle;
      bid = await bid.save();
    } else {
      // Create new bid
      bid = await new Bid({
        booking: bookingId,
        rider: riderId,
        bidAmount,
        commissionRate: appCommission.value,
        riderIncome,
        selectedVehicle,
      }).save();
    }

    // Update booking status
    await Booking.findByIdAndUpdate(bookingId, { status: 'bid_placed' });

    // Increment ride count for the rider
    await globalLimit.incrementRideCount(riderId);

    req.io.emit('newBid', bid);

    // TODO: Send notification to the booking creator (hotel/broker)

    res.json({
      ...bid.toObject(),
      remainingRides: globalLimit.getRemainingRides(riderId),
      dailyLimit: globalLimit.dailyLimit
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};

exports.acceptBid = async (req, res) => {
  const { bidId } = req.params;
  const { bookingId } = req.body;

  try {
    // 1. Find the accepted bid and update its status
    const acceptedBid = await Bid.findByIdAndUpdate(
      bidId,
      { status: 'accepted' },
      { new: true }
    );

    if (!acceptedBid) {
      return res.status(404).json({ msg: 'Bid not found' });
    }

    // 2. Check ride limit before accepting bid
    const globalLimit = await RideLimit.getGlobalRideLimit();
    const eligibility = globalLimit.canTakeRideAction(acceptedBid.rider.toString());
    
    if (!eligibility.canTakeAction) {
      return res.status(400).json({ 
        msg: eligibility.reason,
        remainingRides: eligibility.remainingRides,
        dailyLimit: globalLimit.dailyLimit
      });
    }

    // 3. Find the booking and update its status to 'confirmed'
    // and set the selected rider and confirmed bid.
    const updatedBooking = await Booking.findByIdAndUpdate(bookingId, {
      status: 'confirmed',
      rider: acceptedBid.rider,
      confirmedBid: acceptedBid._id,
    }, { new: true });

    if (!updatedBooking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // 4. Reject all other bids for the same booking
    await Bid.updateMany(
      { booking: bookingId, _id: { $ne: bidId } },
      { status: 'rejected' }
    );

    // 5. Increment ride count for the rider (accepting a bid counts as a ride action)
    await globalLimit.incrementRideCount(acceptedBid.rider.toString());

    // 6. Emit a socket event to notify clients
    req.io.emit('bidAccepted', { bookingId, bidId });

    res.json({ 
      msg: 'Bid accepted successfully',
      remainingRides: globalLimit.getRemainingRides(acceptedBid.rider.toString()),
      dailyLimit: globalLimit.dailyLimit
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
