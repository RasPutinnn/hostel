#!/bin/bash

# OTA Integration Deployment Script
# This script deploys the OTA Integration Service to Kubernetes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE=${NAMESPACE:-default}
ENVIRONMENT=${ENVIRONMENT:-production}
IMAGE_TAG=${IMAGE_TAG:-latest}
REGISTRY=${REGISTRY:-ghcr.io}
REPO_NAME=${REPO_NAME:-$(basename $(git remote get-url origin) .git)}

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

# Function to check prerequisites
check_prerequisites() {
    print_step "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        print_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check if we can connect to cluster
    if ! kubectl cluster-info &> /dev/null; then
        print_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
        exit 1
    fi
    
    # Check if we're in the right directory
    if [ ! -d "infrastructure/k8s/ota" ]; then
        print_error "infrastructure/k8s/ota directory not found. Please run from project root."
        exit 1
    fi
    
    print_status "Prerequisites check passed"
}

# Function to create namespace if it doesn't exist
create_namespace() {
    print_step "Checking namespace: $NAMESPACE"
    
    if kubectl get namespace "$NAMESPACE" &> /dev/null; then
        print_status "Namespace $NAMESPACE already exists"
    else
        print_status "Creating namespace: $NAMESPACE"
        kubectl create namespace "$NAMESPACE"
    fi
}

# Function to handle secrets
deploy_secrets() {
    print_step "Deploying secrets..."
    
    # Check if secrets already exist
    if kubectl get secret ota-secrets -n "$NAMESPACE" &> /dev/null; then
        print_warning "Secret 'ota-secrets' already exists in namespace $NAMESPACE"
        read -p "Do you want to update it? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kubectl delete secret ota-secrets -n "$NAMESPACE"
            print_status "Existing secret deleted"
        else
            print_status "Keeping existing secret"
            return 0
        fi
    fi
    
    # Check if secret values are set
    if [ -z "$BOOKING_API_KEY" ] || [ -z "$HOSTELWORLD_API_KEY" ]; then
        print_error "Required environment variables not set:"
        print_error "Please set: BOOKING_API_KEY, HOSTELWORLD_API_KEY, etc."
        print_error "You can source them from a file: source .env.production"
        exit 1
    fi
    
    # Create secret from environment variables
    kubectl create secret generic ota-secrets -n "$NAMESPACE" \
        --from-literal=booking-api-key="$BOOKING_API_KEY" \
        --from-literal=booking-username="$BOOKING_USERNAME" \
        --from-literal=booking-password="$BOOKING_PASSWORD" \
        --from-literal=booking-hotel-id="$BOOKING_HOTEL_ID" \
        --from-literal=booking-webhook-secret="$BOOKING_WEBHOOK_SECRET" \
        --from-literal=hostelworld-api-key="$HOSTELWORLD_API_KEY" \
        --from-literal=hostelworld-api-secret="$HOSTELWORLD_API_SECRET" \
        --from-literal=hostelworld-property-id="$HOSTELWORLD_PROPERTY_ID" \
        --from-literal=hostelworld-webhook-secret="$HOSTELWORLD_WEBHOOK_SECRET" \
        --from-literal=redis-password="${REDIS_PASSWORD:-}"
    
    print_status "Secrets deployed successfully"
}

# Function to deploy Redis
deploy_redis() {
    print_step "Deploying Redis..."
    
    # Apply Redis configuration
    kubectl apply -f infrastructure/k8s/ota/redis.yaml -n "$NAMESPACE"
    
    # Wait for Redis to be ready
    print_status "Waiting for Redis to be ready..."
    kubectl wait --for=condition=ready pod -l app=redis -n "$NAMESPACE" --timeout=120s
    
    print_status "Redis deployed and ready"
}

# Function to deploy OTA integration service
deploy_ota_service() {
    print_step "Deploying OTA Integration Service..."
    
    # Update image tag in deployment
    if [ -f "infrastructure/k8s/ota/ota-integration-deployment.yaml" ]; then
        # Create a temporary file with updated image
        cp infrastructure/k8s/ota/ota-integration-deployment.yaml /tmp/ota-deployment-temp.yaml
        sed -i "s|your-registry/ota-integration:latest|$REGISTRY/$REPO_NAME/ota-integration:$IMAGE_TAG|g" /tmp/ota-deployment-temp.yaml
        
        # Apply the deployment
        kubectl apply -f /tmp/ota-deployment-temp.yaml -n "$NAMESPACE"
        
        # Clean up temp file
        rm /tmp/ota-deployment-temp.yaml
    else
        print_error "Deployment file not found: infrastructure/k8s/ota/ota-integration-deployment.yaml"
        exit 1
    fi
    
    # Wait for deployment to be ready
    print_status "Waiting for OTA Integration Service to be ready..."
    kubectl rollout status deployment/ota-integration-service -n "$NAMESPACE" --timeout=300s
    
    print_status "OTA Integration Service deployed successfully"
}

# Function to run post-deployment checks
post_deployment_checks() {
    print_step "Running post-deployment checks..."
    
    # Check pod status
    print_status "Checking pod status..."
    kubectl get pods -l app=ota-integration -n "$NAMESPACE"
    
    # Wait for pods to be ready
    kubectl wait --for=condition=ready pod -l app=ota-integration -n "$NAMESPACE" --timeout=120s
    
    # Get service information
    print_status "Service information:"
    kubectl get service ota-integration-service -n "$NAMESPACE"
    
    # Health check
    print_status "Performing health check..."
    SERVICE_IP=$(kubectl get service ota-integration-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    
    # Run health check from within the cluster
    kubectl run healthcheck-pod --image=curlimages/curl:latest --rm -i --restart=Never -n "$NAMESPACE" -- \
        curl -f -m 10 http://$SERVICE_IP:3003/health
    
    print_status "Health check passed!"
}

# Function to show deployment information
show_deployment_info() {
    print_step "Deployment Information"
    
    echo ""
    echo "=== Deployment Summary ==="
    echo "Environment: $ENVIRONMENT"
    echo "Namespace: $NAMESPACE"
    echo "Image Tag: $IMAGE_TAG"
    echo "Registry: $REGISTRY"
    
    echo ""
    echo "=== Service Endpoints ==="
    if kubectl get ingress ota-integration-ingress -n "$NAMESPACE" &> /dev/null; then
        INGRESS_HOST=$(kubectl get ingress ota-integration-ingress -n "$NAMESPACE" -o jsonpath='{.spec.rules[0].host}')
        echo "External URL: https://$INGRESS_HOST"
    fi
    
    SERVICE_IP=$(kubectl get service ota-integration-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    echo "Internal Service: http://$SERVICE_IP:3003"
    echo "Health Check: http://$SERVICE_IP:3003/health"
    
    echo ""
    echo "=== Useful Commands ==="
    echo "View logs: kubectl logs -f deployment/ota-integration-service -n $NAMESPACE"
    echo "Scale service: kubectl scale deployment ota-integration-service --replicas=3 -n $NAMESPACE"
    echo "Port forward: kubectl port-forward service/ota-integration-service 3003:3003 -n $NAMESPACE"
    echo "Delete deployment: kubectl delete -f infrastructure/k8s/ota/ -n $NAMESPACE"
    
    echo ""
    echo "=== Monitoring ==="
    echo "Check pods: kubectl get pods -l app=ota-integration -n $NAMESPACE"
    echo "Describe service: kubectl describe service ota-integration-service -n $NAMESPACE"
    echo "Check events: kubectl get events -n $NAMESPACE --sort-by=.metadata.creationTimestamp"
}

# Function to rollback deployment
rollback_deployment() {
    print_error "Deployment failed. Initiating rollback..."
    
    # Rollback to previous version
    kubectl rollout undo deployment/ota-integration-service -n "$NAMESPACE"
    
    # Wait for rollback to complete
    kubectl rollout status deployment/ota-integration-service -n "$NAMESPACE" --timeout=300s
    
    print_status "Rollback completed"
}

# Main deployment function
main() {
    echo "🚀 Starting OTA Integration Service Deployment"
    echo "Environment: $ENVIRONMENT"
    echo "Namespace: $NAMESPACE"
    echo "Image Tag: $IMAGE_TAG"
    echo ""
    
    # Trap errors and run rollback
    trap 'rollback_deployment' ERR
    
    check_prerequisites
    create_namespace
    
    # Deploy in order
    deploy_secrets
    deploy_redis
    deploy_ota_service
    
    # Verify deployment
    post_deployment_checks
    
    # Show information
    show_deployment_info
    
    print_status "=== Deployment Completed Successfully! 🎉 ==="
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -t|--tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  -n, --namespace    Kubernetes namespace (default: default)"
            echo "  -e, --environment  Environment (default: production)"
            echo "  -t, --tag         Docker image tag (default: latest)"
            echo "  -r, --registry    Container registry (default: ghcr.io)"
            echo "  -h, --help        Show this help message"
            echo ""
            echo "Environment variables required:"
            echo "  BOOKING_API_KEY, BOOKING_USERNAME, BOOKING_PASSWORD, etc."
            echo ""
            echo "Example:"
            echo "  $0 --namespace production --tag v1.0.0"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main function
main