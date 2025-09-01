require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { startCronJobs } = require('./utils/cronJobs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

// Connect Database
connectDB();

// Init Middleware
app.use(express.json({ extended: false }));
app.use(cookieParser());
app.use(cors());

// Socket.io middleware to attach io to req
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Define Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/cities', require('./routes/cities'));
app.use('/api/subareas', require('./routes/subAreas'));
app.use('/api/vehicle-categories', require('./routes/vehicleCategories'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/terms-and-conditions', require('./routes/termsAndConditions'));
app.use('/api/vehicle-status', require('./routes/vehicleStatus'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/app-commission', require('./routes/appCommission'));
app.use('/api/bids', require('./routes/bids'));
app.use('/api/bid-limits', require('./routes/bidLimits'));
app.use('/api/reject-reasons', require('./routes/rejectReasons'));

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  // Start cron jobs after server starts
  startCronJobs();
});
