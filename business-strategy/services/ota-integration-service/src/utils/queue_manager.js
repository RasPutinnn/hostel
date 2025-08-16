// services/ota-integration-service/src/utils/queue-manager.js
const Bull = require('bull');
const Redis = require('redis');
const BookingAdapter = require('../adapters/booking-adapter');
const HostelWorldAdapter = require('../adapters/hostelworld-adapter');
const Logger = require('./logger');

class QueueManager {
  constructor() {
    this.logger = new Logger();
    this.redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB || 0
    };

    // Initialize queues
    this.bookingSyncQueue = new Bull('booking-sync', { redis: this.redisConfig });
    this.hostelWorldSyncQueue = new Bull('hostelworld-sync', { redis: this.redisConfig });
    this.bookingRateSyncQueue = new Bull('booking-rate-sync', { redis: this.redisConfig });
    this.hostelWorldRateSyncQueue = new Bull('hostelworld-rate-sync', { redis: this.redisConfig });
    this.reservationProcessingQueue = new Bull('reservation-processing', { redis: this.redisConfig });

    // Initialize adapters
    this.bookingAdapter = new BookingAdapter();
    this.hostelWorldAdapter = new HostelWorldAdapter();

    // Queue configurations
    this.queueOptions = {
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    };

    this._setupQueues();
  }

  _setupQueues() {
    // Booking.com inventory sync processor
    this.bookingSyncQueue.process('booking-sync', 5, async (job) => {
      const { data } = job;