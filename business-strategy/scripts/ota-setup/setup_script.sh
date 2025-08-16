#!/bin/bash

# OTA Integration Setup Script
# This script sets up the OTA Integration Service for the Hostel Management System

set -e

echo "🚀 Setting up OTA Integration Service..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    print_error "docker-compose.yml not found. Please run this script from the project root."
    exit 1
fi

# Create necessary directories
print_step "Creating directory structure..."
mkdir -p services/ota-integration-service/logs
mkdir -p services/ota-integration-service/config
mkdir -p infrastructure/k8s/ota
mkdir -p scripts/ota-setup
mkdir -p docs/ota-integration
mkdir -p monitoring/grafana/ota-dashboards

print_status "Directory structure created successfully"

# Copy environment file if it doesn't exist
print_step "Setting up environment configuration..."
if [ ! -f "services/ota-integration-service/.env" ]; then
    if [ -f "services/ota-integration-service/.env.example" ]; then
        cp services/ota-integration-service/.env.example services/ota-integration-service/.env
        print_status ".env file created from .env.example"
        print_warning "Please update .env file with your actual OTA credentials"
    else
        print_error ".env.example file not found. Please create it first."
        exit 1
    fi
else
    print_status ".env file already exists"
fi

# Install dependencies
print_step "Installing OTA service dependencies..."
if [ -f "services/ota-integration-service/package.json" ]; then
    cd services/ota-integration-service
    
    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install Node.js and npm first."
        exit 1
    fi
    
    print_status "Installing npm dependencies..."
    npm install
    
    print_status "Dependencies installed successfully"
    cd ../..
else
    print_error "package.json not found in services/ota-integration-service/"
    exit 1
fi

# Check Docker and Docker Compose
print_step "Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

print_status "Docker and Docker Compose are installed"

# Build the OTA integration service
print_step "Building OTA integration service..."
if docker-compose build ota-integration; then
    print_status "OTA integration service built successfully"
else
    print_error "Failed to build OTA integration service"
    exit 1
fi

# Start Redis if not running
print_step "Starting Redis service..."
if docker-compose up -d redis; then
    print_status "Redis service started"
else
    print_error "Failed to start Redis service"
    exit 1
fi

# Wait for Redis to be ready
print_status "Waiting for Redis to be ready..."
sleep 5

# Test Redis connection
if docker-compose exec -T redis redis-cli ping | grep -q PONG; then
    print_status "Redis is ready and responding"
else
    print_warning "Redis might not be fully ready yet"
fi

# Run tests
print_step "Running tests..."
cd services/ota-integration-service
if npm test; then
    print_status "All tests passed!"
else
    print_warning "Some tests failed. Please check the output above."
fi
cd ../..

# Start the OTA integration service
print_step "Starting OTA integration service..."
if docker-compose up -d ota-integration; then
    print_status "OTA integration service started"
else
    print_error "Failed to start OTA integration service"
    exit 1
fi

# Wait for service to be ready
print_status "Waiting for OTA service to be ready..."
sleep 10

# Health check
print_step "Performing health check..."
max_attempts=10
attempt=1

while [ $attempt -le $max_attempts ]; do
    if curl -f http://localhost:3003/health > /dev/null 2>&1; then
        print_status "Health check passed! OTA service is running."
        break
    else
        print_status "Attempt $attempt/$max_attempts - Service not ready yet, waiting..."
        sleep 5
        ((attempt++))
    fi
done

if [ $attempt -gt $max_attempts ]; then
    print_error "Health check failed after $max_attempts attempts"
    print_error "Please check the service logs: docker-compose logs ota-integration"
    exit 1
fi

# Show service status
print_step "Checking service status..."
echo ""
echo "=== OTA Integration Service Status ==="
if curl -s http://localhost:3003/health | python3 -m json.tool 2>/dev/null; then
    print_status "Service is healthy and responding"
else
    print_warning "Service is running but health check response format is unexpected"
fi

echo ""
echo "=== Service Information ==="
echo "OTA Integration Service: http://localhost:3003"
echo "Health Check: http://localhost:3003/health"
echo "API Documentation: http://localhost:3003/api/docs (if implemented)"
echo "Redis Commander: http://localhost:8081 (admin/admin123)"

echo ""
echo "=== Useful Commands ==="
echo "View logs: docker-compose logs -f ota-integration"
echo "Restart service: docker-compose restart ota-integration"
echo "Stop services: docker-compose down"
echo "View Redis data: docker-compose exec redis redis-cli"

echo ""
print_status "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "1. Update services/ota-integration-service/.env with your actual OTA credentials"
echo "2. Test the integration endpoints"
echo "3. Configure webhooks in Booking.com and HostelWorld admin panels"
echo "4. Set up monitoring and alerting"
echo "5. Deploy to production using: ./scripts/ota-setup/deploy-ota.sh"

echo ""
print_warning "Important Security Notes:"
echo "- Never commit .env files with real credentials to Git"
echo "- Use environment variables or secret management in production"
echo "- Enable webhook signature verification"
echo "- Set up proper firewall rules for webhook endpoints"

echo ""
print_status "Setup completed successfully! 🎉"