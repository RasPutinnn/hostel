// services/ota-integration-service/src/adapters/hostelworld-adapter.js
const axios = require('axios');
const crypto = require('crypto');
const Logger = require('../utils/logger');

class HostelWorldAdapter {
  constructor() {
    this.baseURL = process.env.HOSTELWORLD_API_URL || 'https://api.hostelworld.com/v1.0';
    this.apiKey = process.env.HOSTELWORLD_API_KEY;
    this.apiSecret = process.env.HOSTELWORLD_API_SECRET;
    this.propertyId = process.env.HOSTELWORLD_PROPERTY_ID;
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
        config.headers = {
          ...config.headers,
          ...this._getAuthHeaders(config.method, config.url, config.data)
        };
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

  // Generate authentication headers for HostelWorld API
  _getAuthHeaders(method, url, data) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Create signature string
    const signatureString = [
      method.toUpperCase(),
      url,
      this.apiKey,
      timestamp,
      nonce,
      data ? JSON.stringify(data) : ''
    ].join('|');

    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(signatureString)
      .digest('base64');

    return {
      'X-API-Key': this.apiKey,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': signature
    };
  }

  // Update inventory (availability) for a specific room and date
  async updateInventory(inventoryData) {
    try {
      const { roomId, date, available, price, currency = 'USD' } = inventoryData;
      
      const payload = {
        propertyId: this.propertyId,
        roomTypeId: roomId,
        date: date,
        availability: available,
        rate: {
          amount: price,
          currency: currency
        },
        restrictions: {
          closed: available === 0,
          minStay: 1,
          maxStay: 30
        }
      };

      const response = await this.client.put(`/properties/${this.propertyId}/inventory`, payload);

      this.stats.lastSync = new Date().toISOString();
      
      this.logger.info('HostelWorld inventory updated', { 
        roomId, 
        date, 
        available, 
        price,
        responseStatus: response.status 
      });

      return {
        success: true,
        ota: 'hostelworld',
        data: response.data
      };
    } catch (error) {
      this.logger.error('Error updating HostelWorld inventory', {
        error: error.message,
        roomId: inventoryData.roomId,
        date: inventoryData.date,
        response: error.response?.data
      });
      
      throw new Error(`HostelWorld inventory update failed: ${error.message}`);
    }
  }

  // Update rates for a date range
  async updateRates(rateData) {
    try {
      const { roomId, dateFrom, dateTo, rates } = rateData;
      
      const payload = {
        propertyId: this.propertyId,
        roomTypeId: roomId,
        dateFrom: dateFrom,
        dateTo: dateTo,
        rates: rates.map(rate => ({
          date: rate.date,
          amount: rate.price,
          currency: rate.currency || 'USD'
        }))
      };

      const response = await this.client.put(`/properties/${this.propertyId}/rates`, payload);

      this.stats.lastSync = new Date().toISOString();
      
      this.logger.info('HostelWorld rates updated', { 
        roomId, 
        dateFrom, 
        dateTo,
        ratesCount: rates.length,
        responseStatus: response.status 
      });

      return {
        success: true,
        ota: 'hostelworld',
        data: response.data
      };
    } catch (error) {
      this.logger.error('Error updating HostelWorld rates', {
        error: error.message,
        roomId: rateData.roomId,
        dateFrom: rateData.dateFrom,
        dateTo: rateData.dateTo,
        response: error.response?.data
      });
      
      throw new Error(`HostelWorld rates update failed: ${error.message}`);
    }
  }

  // Process incoming webhook from HostelWorld
  async processWebhook(payload, headers) {
    try {
      // Verify webhook signature
      if (!this._verifyWebhookSignature(payload, headers)) {
        throw new Error('Invalid webhook signature');
      }

      const reservation = this._transformHostelWorldReservation(payload);
      
      this.logger.info('HostelWorld webhook processed', { 
        reservationId: reservation.id,
        type: payload.eventType 
      });

      return reservation;
    } catch (error) {
      this.logger.error('Error processing HostelWorld webhook', {
        error: error.message,
        payload: JSON.stringify(payload)
      });
      
      throw error;
    }
  }

  // Verify webhook signature
  _verifyWebhookSignature(payload, headers) {
    const signature = headers['x-hostelworld-signature'];
    const webhookSecret = process.env.HOSTELWORLD_WEBHOOK_SECRET;
    
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

  // Transform HostelWorld reservation to internal format
  _transformHostelWorldReservation(hostelWorldData) {
    const booking = hostelWorldData.booking;
    
    return {
      id: booking.bookingId,
      ota: 'hostelworld',
      otaReservationId: booking.bookingId,
      guestName: `${booking.guest.firstName} ${booking.guest.lastName}`,
      guestEmail: booking.guest.email,
      guestPhone: booking.guest.phone || '',
      checkIn: booking.checkInDate,
      checkOut: booking.checkOutDate,
      roomId: booking.roomType.id,
      roomType: booking.roomType.name,
      totalPrice: booking.totalAmount,
      currency: booking.currency,
      status: this._mapHostelWorldStatus(booking.status),
      numberOfGuests: booking.numberOfGuests,
      specialRequests: booking.specialRequests || '',
      bookingDate: booking.bookingDate,
      source: 'hostelworld.com',
      commission: booking.commission || 0,
      paymentMethod: booking.paymentMethod || 'ota_collect',
      bedType: booking.bedType || 'mixed'
    };
  }

  // Map HostelWorld status to internal status
  _mapHostelWorldStatus(hostelWorldStatus) {
    const statusMap = {
      'confirmed': 'confirmed',
      'cancelled': 'cancelled',
      'no_show': 'no_show',
      'checked_in': 'checked_in',
      'checked_out': 'checked_out',
      'pending': 'pending'
    };
    
    return statusMap[hostelWorldStatus] || 'unknown';
  }

  // Get room types from HostelWorld
  async getRoomTypes() {
    try {
      const response = await this.client.get(`/properties/${this.propertyId}/roomtypes`);
      
      this.logger.info('HostelWorld room types fetched', { 
        count: response.data.roomTypes?.length || 0 
      });

      return response.data.roomTypes || [];
    } catch (error) {
      this.logger.error('Error fetching HostelWorld room types', {
        error: error.message,
        response: error.response?.data
      });
      
      throw new Error(`HostelWorld room types fetch failed: ${error.message}`);
    }
  }

  // Get bookings for a date range
  async getBookings(dateFrom, dateTo) {
    try {
      const response = await this.client.get(`/properties/${this.propertyId}/bookings`, {
        params: {
          dateFrom: dateFrom,
          dateTo: dateTo
        }
      });
      
      this.logger.info('HostelWorld bookings fetched', { 
        dateFrom,
        dateTo,
        count: response.data.bookings?.length || 0 
      });

      return response.data.bookings || [];
    } catch (error) {
      this.logger.error('Error fetching HostelWorld bookings', {
        error: error.message,
        dateFrom,
        dateTo,
        response: error.response?.data
      });
      
      throw new Error(`HostelWorld bookings fetch failed: ${error.message}`);
    }
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

  // Test connection to HostelWorld API
  async testConnection() {
    try {
      const response = await this.client.get(`/properties/${this.propertyId}/info`);
      
      this.healthy = true;
      return { success: true, message: 'Connection successful', data: response.data };
    } catch (error) {
      this.healthy = false;
      return { success: false, message: error.message };
    }
  }
}

module.exports = HostelWorldAdapter;