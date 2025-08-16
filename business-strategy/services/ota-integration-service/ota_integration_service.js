// services/ota-integration-service/src/app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const BookingAdapter = require('./adapters/booking-adapter');
const HostelWorldAdapter = require('./adapters/hostelworld-adapter');
const QueueManager = require('./utils/queue-manager');
const Logger = require('./utils/logger');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Initialize adapters
const bookingAdapter = new BookingAdapter();
const hostelWorldAdapter = new HostelWorldAdapter();
const queueManager = new QueueManager();
const logger = new Logger();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    services: {
      booking: bookingAdapter.isHealthy(),
      hostelworld: hostelWorldAdapter.isHealthy()
    }
  });
});

// Sync inventory to all OTAs
app.post('/api/ota/sync-inventory', async (req, res) => {
  try {
    const { roomId, date, available, price, currency = 'USD' } = req.body;
    
    if (!roomId || !date || available === undefined || !price) {
      return res.status(400).json({ 
        error: 'Missing required fields: roomId, date, available, price' 
      });
    }

    const inventoryData = { roomId, date, available, price, currency };
    
    // Queue sync operations
    const bookingJob = await queueManager.addJob('booking-sync', inventoryData);
    const hostelWorldJob = await queueManager.addJob('hostelworld-sync', inventoryData);

    logger.info('Inventory sync queued', { roomId, date, bookingJobId: bookingJob.id, hostelWorldJobId: hostelWorldJob.id });

    res.json({ 
      status: 'queued',
      jobs: {
        booking: bookingJob.id,
        hostelworld: hostelWorldJob.id
      }
    });
  } catch (error) {
    logger.error('Error syncing inventory', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync rates to all OTAs
app.post('/api/ota/sync-rates', async (req, res) => {
  try {
    const { roomId, dateFrom, dateTo, rates } = req.body;
    
    if (!roomId || !dateFrom || !dateTo || !rates) {
      return res.status(400).json({ 
        error: 'Missing required fields: roomId, dateFrom, dateTo, rates' 
      });
    }

    const rateData = { roomId, dateFrom, dateTo, rates };
    
    const bookingJob = await queueManager.addJob('booking-rate-sync', rateData);
    const hostelWorldJob = await queueManager.addJob('hostelworld-rate-sync', rateData);

    logger.info('Rate sync queued', { roomId, dateFrom, dateTo });

    res.json({ 
      status: 'queued',
      jobs: {
        booking: bookingJob.id,
        hostelworld: hostelWorldJob.id
      }
    });
  } catch (error) {
    logger.error('Error syncing rates', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint for Booking.com
app.post('/api/webhooks/booking', async (req, res) => {
  try {
    const reservation = await bookingAdapter.processWebhook(req.body, req.headers);
    
    // Forward to internal booking service
    await queueManager.addJob('process-booking-reservation', reservation);
    
    logger.info('Booking.com webhook processed', { reservationId: reservation.id });
    res.status(200).json({ status: 'processed' });
  } catch (error) {
    logger.error('Error processing Booking.com webhook', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Webhook endpoint for HostelWorld
app.post('/api/webhooks/hostelworld', async (req, res) => {
  try {
    const reservation = await hostelWorldAdapter.processWebhook(req.body, req.headers);
    
    // Forward to internal booking service
    await queueManager.addJob('process-hostelworld-reservation', reservation);
    
    logger.info('HostelWorld webhook processed', { reservationId: reservation.id });
    res.status(200).json({ status: 'processed' });
  } catch (error) {
    logger.error('Error processing HostelWorld webhook', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Get sync status
app.get('/api/ota/sync-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await queueManager.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      id: job.id,
      status: await job.getState(),
      progress: job.progress(),
      data: job.data,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason
    });
  } catch (error) {
    logger.error('Error getting sync status', error);
    res.status(500).json({ error: error.message });
  }
});

// Get OTA statistics
app.get('/api/ota/stats', async (req, res) => {
  try {
    const stats = {
      booking: await bookingAdapter.getStats(),
      hostelworld: await hostelWorldAdapter.getStats(),
      queue: await queueManager.getStats()
    };
    
    res.json(stats);
  } catch (error) {
    logger.error('Error getting OTA stats', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start queue processing
queueManager.startProcessing();

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  logger.info(`OTA Integration Service running on port ${PORT}`);
});

module.exports = app;