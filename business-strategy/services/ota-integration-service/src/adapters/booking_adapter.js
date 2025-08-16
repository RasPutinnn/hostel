// services/ota-integration-service/src/adapters/booking-adapter.js
const axios = require('axios');
const crypto = require('crypto');
const Logger = require('../utils/logger');

class BookingAdapter {
  constructor() {
    this.baseURL = process.env.BOOKING_API_URL || 'https://distribution-xml.booking.com/json/bookings';
    this.apiKey = process.env.BOOKING_API_KEY;
    this.username = process.env.BOOKING_USERNAME;
    this.password = process.env.BOOKING_PASSWORD;
    this.hotelId = process.env.BOOKING_HOTEL_ID;
    this.logger = new Logger();
    this.healthy = true;
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      lastSync: null
    };

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HostelDevOps/1.0'
      }
    });

    this.client.interceptors.request.use(
      (config) => {
        this.stats.totalRequests++;
        return config;
      },
      (error) => {
        this.stats.failedRequests++;
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        this.stats.successfulRequests++;
        this.healthy = true;
        return response;
      },
      (error) => {
        this.stats.failedRequests++;
        if (error.response?.status >= 500) {
          this.healthy = false;
        }
        return Promise.reject(error);
      }
    );
  }

  // Generate authentication headers
  _getAuthHeaders() {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');
    
    return {
      'X-Booking-Username': this.username,
      'X-Booking-Password': this.password,
      'X-Booking-Timestamp': timestamp,
      'X-Booking-Nonce': nonce
    };
  }

  // Update inventory (availability) for a specific room and date
  async updateInventory(inventoryData) {
    try {
      const { roomId, date, available, price, currency = 'USD' } = inventoryData;
      
      const payload = {
        hotel_id: this.hotelId,
        room_id: roomId,
        date: date,
        availability: available,
        rate: price,
        currency: currency,
        close_out: available === 0 ? 1 : 0
      };

      const response = await this.client.post('/bookings.updateAvailability', payload, {
        headers: {
          ...this._getAuthHeaders(),
          'X-Booking-API-Key': this.apiKey
        }
      });

      this.stats.lastSync = new Date().toISOString();
      
      this.logger.info('Booking.com inventory updated', { 
        roomId, 
        date, 
        available, 
        price,
        responseStatus: response.status 
      });

      return {
        success: true,
        ota: 'booking',
        data: response.data
      };
    } catch (error) {
      this.logger.error('Error updating Booking.com inventory', {
        error: error.message,
        roomId: inventoryData.roomId,
        date: inventoryData.date,
        response: error.response?.data
      });
      
      throw new Error(`Booking.com inventory update failed: ${error.message}`);
    }
  }

  // Update rates for a date range
  async updateRates(rateData) {
    try {
      const { roomId, dateFrom, dateTo, rates } = rateData;
      
      const payload = {
        hotel_id: this.hotelId,
        room_id: roomId,
        date_from: dateFrom,
        date_to: dateTo,
        rates: rates.map(rate => ({
          date: rate.date,
          rate: rate.price,
          currency: rate.currency || 'USD'
        }))
      };

      const response = await this.client.post('/bookings.updateRates', payload, {
        headers: {
          ...this._getAuthHeaders(),
          'X-Booking-API-Key': this.apiKey
        }
      });

      this.stats.lastSync = new Date().toISOString();
      
      this.logger.info('Booking.com rates updated', { 
        roomId, 
        dateFrom, 
        dateTo,
        ratesCount: rates.length,
        responseStatus: response.status 
      });

      return {
        success: true,
        ota: 'booking',
        data: response.data
      };
    } catch (error) {
      this.logger.error('Error updating Booking.com rates', {
        error: error.message,
        roomId: rateData.roomId,
        dateFrom: rateData.dateFrom,
        dateTo: rateData.dateTo,
        response: error.response?.data
      });
      
      throw new Error(`Booking.com rates update failed: ${error.message}`);
    }
  }

  // Process incoming webhook from Booking.com
  async processWebhook(payload, headers) {
    try {
      // Verify webhook signature
      if (!this._verifyWebhookSignature(payload, headers)) {
        throw new Error('Invalid webhook signature');
      }

      const reservation = this._transformBookingReservation(payload);
      
      this.logger.info('Booking.com webhook processed', { 
        reservationId: reservation.id,
        type: payload.type 
      });

      return reservation;
    } catch (error) {
      this.logger.error('Error processing Booking.com webhook', {
        error: error.message,
        payload: JSON.stringify(payload)
      });
      
      throw error;
    }
  }

  // Verify webhook signature
  _verifyWebhookSignature(payload, headers) {
    const signature = headers['x-booking-signature'];
    const webhookSecret = process.env.BOOKING_WEBHOOK_SECRET;
    
    if (!signature || !webhookSecret) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  // Transform Booking.com reservation to internal format
  _transformBookingReservation(bookingData) {
    return {
      id: bookingData.reservation_id,
      ota: 'booking',
      otaReservationId: bookingData.reservation_id,
      guestName: `${bookingData.guest.first_name} ${bookingData.guest.last_name}`,
      guestEmail: bookingData.guest.email,
      guestPhone: bookingData.guest.phone,
      checkIn: bookingData.check_in_date,
      checkOut: bookingData.check_out_date,
      roomId: bookingData.room_id,
      roomType: bookingData.room_type,
      totalPrice: bookingData.total_price,
      currency: bookingData.currency,
      status: this._mapBookingStatus(bookingData.status),
      numberOfGuests: bookingData.number_of_guests,
      specialRequests: bookingData.special_requests || '',
      bookingDate: bookingData.booking_date,
      source: 'booking.com',
      commission: bookingData.commission || 0,
      paymentMethod: bookingData.payment_method || 'ota_collect'
    };
  }

  // Map Booking.com status to internal status
  _mapBookingStatus(bookingStatus) {
    const statusMap = {
      'confirmed': 'confirmed',
      'cancelled': 'cancelled',
      'no_show': 'no_show',
      'checked_in': 'checked_in',
      'checked_out': 'checked_out'
    };
    
    return statusMap[bookingStatus] || 'unknown';
  }

  // Get current statistics
  getStats() {
    return {
      ...this.stats,
      healthStatus: this.healthy ? 'healthy' : 'unhealthy',
      successRate: this.stats.totalRequests > 0 
        ? (this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  // Check if adapter is healthy
  isHealthy() {
    return this.healthy;
  }

  // Test connection to Booking.com API
  async testConnection() {
    try {
      const response = await this.client.get('/bookings.test', {
        headers: {
          ...this._getAuthHeaders(),
          'X-Booking-API-Key': this.apiKey
        }
      });
      
      this.healthy = true;
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      this.healthy = false;
      return { success: false, message: error.message };
    }
  }
}

module.exports = BookingAdapter;