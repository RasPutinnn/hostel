# Server Configuration
PORT=3003
NODE_ENV=development

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Booking.com Configuration
BOOKING_API_URL=https://distribution-xml.booking.com/json/bookings
BOOKING_API_KEY=your_booking_api_key_here
BOOKING_USERNAME=your_booking_username_here
BOOKING_PASSWORD=your_booking_password_here
BOOKING_HOTEL_ID=your_hotel_id_here
BOOKING_WEBHOOK_SECRET=your_booking_webhook_secret_here

# HostelWorld Configuration
HOSTELWORLD_API_URL=https://api.hostelworld.com/v1.0
HOSTELWORLD_API_KEY=your_hostelworld_api_key_here
HOSTELWORLD_API_SECRET=your_hostelworld_api_secret_here
HOSTELWORLD_PROPERTY_ID=your_hostelworld_property_id_here
HOSTELWORLD_WEBHOOK_SECRET=your_hostelworld_webhook_secret_here

# Logging Configuration
LOG_LEVEL=info
LOG_PATH=logs

# Integration URLs (adjust according to your existing services)
OPERATIONS_API_URL=http://operations-service:3001
BOOKING_SERVICE_URL=http://booking-service:3000
MONITORING_API_URL=http://monitoring-service:3002

# Queue Configuration
QUEUE_CONCURRENCY_BOOKING=5
QUEUE_CONCURRENCY_HOSTELWORLD=5
QUEUE_CONCURRENCY_RATES=3

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Health Check
HEALTH_CHECK_TIMEOUT=5000