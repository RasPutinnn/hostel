// services/ota-integration-service/src/tests/setup.js
// Test setup and configuration

// Set test environment
process.env.NODE_ENV = 'test';

// Override environment variables for testing
process.env.PORT = '0'; // Use random available port
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_DB = '1'; // Use different DB for tests
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Mock OTA API credentials
process.env.BOOKING_API_URL = 'https://test-api.booking.com';
process.env.BOOKING_API_KEY = 'test_booking_api_key';
process.env.BOOKING_USERNAME = 'test_booking_user';
process.env.BOOKING_PASSWORD = 'test_booking_pass';
process.env.BOOKING_HOTEL_ID = 'test_hotel_123';
process.env.BOOKING_WEBHOOK_SECRET = 'test_booking_webhook_secret';

process.env.HOSTELWORLD_API_URL = 'https://test-api.hostelworld.com';
process.env.HOSTELWORLD_API_KEY = 'test_hostelworld_api_key';
process.env.HOSTELWORLD_API_SECRET = 'test_hostelworld_api_secret';
process.env.HOSTELWORLD_PROPERTY_ID = 'test_property_456';
process.env.HOSTELWORLD_WEBHOOK_SECRET = 'test_hostelworld_webhook_secret';

// Queue configuration for tests
process.env.QUEUE_CONCURRENCY_BOOKING = '1';
process.env.QUEUE_CONCURRENCY_HOSTELWORLD = '1';
process.env.QUEUE_CONCURRENCY_RATES = '1';

// Rate limiting for tests
process.env.RATE_LIMIT_WINDOW_MS = '60000'; // 1 minute for tests
process.env.RATE_LIMIT_MAX_REQUESTS = '1000'; // High limit for tests

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise in tests
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});

// Global test helpers
global.createMockInventoryData = () => ({
  roomId: 1,
  date: '2024-01-15',
  available: 10,
  price: 50.00,
  currency: 'USD'
});

global.createMockRateData = () => ({
  roomId: 1,
  dateFrom: '2024-01-15',
  dateTo: '2024-01-20',
  rates: [
    { date: '2024-01-15', price: 50.00, currency: 'USD' },
    { date: '2024-01-16', price: 55.00, currency: 'USD' },
    { date: '2024-01-17', price: 52.00, currency: 'USD' }
  ]
});

global.createMockBookingWebhook = () => ({
  reservation_id: 'BK123456789',
  type: 'reservation_created',
  guest: {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    phone: '+1234567890'
  },
  check_in_date: '2024-01-15',
  check_out_date: '2024-01-17',
  room_id: 1,
  room_type: 'Dormitory Bed',
  total_price: 100.00,
  currency: 'USD',
  status: 'confirmed',
  number_of_guests: 1,
  special_requests: 'Late check-in requested',
  booking_date: '2024-01-10T10:30:00Z',
  commission: 15.00,
  payment_method: 'ota_collect'
});

global.createMockHostelWorldWebhook = () => ({
  eventType: 'booking_created',
  timestamp: '2024-01-10T11:00:00Z',
  booking: {
    bookingId: 'HW987654321',
    guest: {
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@example.com',
      phone: '+1987654321'
    },
    checkInDate: '2024-01-16',
    checkOutDate: '2024-01-18',
    roomType: {
      id: 2,
      name: 'Private Room'
    },
    totalAmount: 120.00,
    currency: 'USD',
    status: 'confirmed',
    numberOfGuests: 2,
    specialRequests: 'Non-smoking room',
    bookingDate: '2024-01-11T09:15:00Z',
    commission: 18.00,
    paymentMethod: 'ota_collect',
    bedType: 'mixed'
  }
});

// Mock Redis client for tests
global.mockRedisClient = () => ({
  ping: jest.fn().mockResolvedValue('PONG'),
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(0),
  expire: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  flushdb: jest.fn().mockResolvedValue('OK'),
  quit: jest.fn().mockResolvedValue('OK')
});

// Clean up function for tests
global.cleanupTest = async () => {
  // Clear all mocks
  jest.clearAllMocks();
  
  // Reset environment variables if needed
  // This can be useful for tests that modify env vars
};

// Error handler for unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't throw in tests, just log
});

// Handle uncaught exceptions in tests
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit in tests
});