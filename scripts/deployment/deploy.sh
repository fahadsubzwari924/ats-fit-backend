#!/bin/bash

# ========================================================================
# ATS Fit Backend - Manual Deployment Script
# ========================================================================
# Description: Complete manual deployment script for Google Cloud Run
# Author: ATS Fit Team
# Version: 1.0.0
# Last Updated: $(date)
# ========================================================================

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# ========================================================================
# Configuration & Constants
# ========================================================================

# Project Configuration
readonly PROJECT_ID="ats-fit-backend"
readonly REGION="asia-south1"
readonly SERVICE_NAME="ats-fit-backend"
readonly REGISTRY="gcr.io"

# Database Configuration  
readonly DB_INSTANCE="ats-fit-postgres"
readonly DB_NAME="ats_fit"
readonly REDIS_INSTANCE="ats-fit-redis"

# Build Configuration
readonly BUILD_TIMEOUT="1200s"
readonly MEMORY_LIMIT="2Gi"
readonly CPU_LIMIT="2"
readonly MAX_INSTANCES="10"
readonly CONCURRENCY="100"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Deployment timestamp
readonly TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
readonly IMAGE_TAG="manual-${TIMESTAMP}"

# ========================================================================
# Utility Functions
# ========================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

check_dependencies() {
    log_info "Checking required dependencies..."
    
    local missing_deps=()
    
    command -v gcloud >/dev/null 2>&1 || missing_deps+=("gcloud")
    command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_info "Please install missing dependencies and try again"
        exit 1
    fi
    
    log_success "All dependencies found"
}

verify_gcloud_auth() {
    log_info "Verifying Google Cloud authentication..."
    
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        log_error "No active Google Cloud authentication found"
        log_info "Please run: gcloud auth login"
        exit 1
    fi
    
    # Verify project access
    if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
        log_error "Cannot access project: $PROJECT_ID"
        log_info "Please verify project ID and permissions"
        exit 1
    fi
    
    # Set project
    gcloud config set project "$PROJECT_ID" --quiet
    log_success "Authenticated and project set to: $PROJECT_ID"
}

verify_docker() {
    log_info "Verifying Docker daemon..."
    
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running"
        log_info "Please start Docker and try again"
        exit 1
    fi
    
    log_success "Docker daemon is running"
}

# ========================================================================
# Pre-deployment Checks
# ========================================================================

pre_deployment_checks() {
    log_header "PRE-DEPLOYMENT CHECKS"
    
    check_dependencies
    verify_gcloud_auth
    verify_docker
    
    # Check if required files exist
    local required_files=("Dockerfile" "package.json" "src/main.ts")
    for file in "${required_files[@]}"; do
        if [ ! -f "$file" ]; then
            log_error "Required file not found: $file"
            exit 1
        fi
    done
    
    log_success "All pre-deployment checks passed"
}

# ========================================================================
# Environment Configuration
# ========================================================================

load_environment_variables() {
    log_header "ENVIRONMENT CONFIGURATION"
    log_info "Loading environment variables from secrets..."
    
    # Database credentials
    local db_password
    db_password=$(gcloud secrets versions access latest --secret="database-password" 2>/dev/null || echo "")
    
    if [ -z "$db_password" ]; then
        log_error "Failed to retrieve database password from Secret Manager"
        exit 1
    fi
    
    # Redis configuration
    local redis_host
    redis_host=$(gcloud redis instances describe "$REDIS_INSTANCE" --region="$REGION" --format="value(host)" 2>/dev/null || echo "")
    
    if [ -z "$redis_host" ]; then
        log_error "Failed to retrieve Redis host"
        exit 1
    fi
    
    # Store in deployment variables
    export DATABASE_PASSWORD="$db_password"
    export REDIS_HOST="$redis_host"
    
    log_success "Environment variables loaded successfully"
}

# ========================================================================
# Build & Push Image
# ========================================================================

build_and_push_image() {
    log_header "BUILDING & PUSHING DOCKER IMAGE"
    
    local image_url="${REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:${IMAGE_TAG}"
    local latest_url="${REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}:latest"
    
    log_info "Building Docker image..."
    log_info "Image tag: $IMAGE_TAG"
    
    # Build with proper caching and multi-stage optimization
    docker build \
        --target production \
        --cache-from "${latest_url}" \
        --tag "${image_url}" \
        --tag "${latest_url}" \
        --build-arg BUILDKIT_INLINE_CACHE=1 \
        . || {
        log_error "Docker build failed"
        exit 1
    }
    
    log_success "Docker image built successfully"
    
    # Configure Docker for GCR
    log_info "Configuring Docker for Google Container Registry..."
    gcloud auth configure-docker --quiet
    
    # Push images
    log_info "Pushing images to Container Registry..."
    docker push "${image_url}" || {
        log_error "Failed to push image with tag: $IMAGE_TAG"
        exit 1
    }
    
    docker push "${latest_url}" || {
        log_error "Failed to push latest image"
        exit 1
    }
    
    log_success "Images pushed successfully"
    
    # Store image URL for deployment
    export DEPLOYMENT_IMAGE="$image_url"
}

# ========================================================================
# Deploy to Cloud Run
# ========================================================================

deploy_to_cloud_run() {
    log_header "DEPLOYING TO CLOUD RUN"
    
    log_info "Deploying service: $SERVICE_NAME"
    log_info "Region: $REGION"
    log_info "Image: $DEPLOYMENT_IMAGE"
    
    # Prepare environment variables
    local env_vars=""
    env_vars+="NODE_ENV=production,"
    env_vars+="DATABASE_HOST=/cloudsql/${PROJECT_ID}:${REGION}:${DB_INSTANCE},"
    env_vars+="DATABASE_NAME=${DB_NAME},"
    env_vars+="DATABASE_USERNAME=postgres,"
    env_vars+="DATABASE_PASSWORD=${DATABASE_PASSWORD},"
    env_vars+="DATABASE_PORT=5432,"
    env_vars+="REDIS_HOST=${REDIS_HOST},"
    env_vars+="REDIS_PORT=6379,"
    env_vars+="REDIS_PASSWORD=redis_password,"
    env_vars+="JWT_SECRET=$(gcloud secrets versions access latest --secret="jwt-secret"),"
    env_vars+="JWT_EXPIRES_IN=24h,"
    env_vars+="OPENAI_API_KEY=$(gcloud secrets versions access latest --secret="openai-api-key"),"
    env_vars+="ANTHROPIC_API_KEY=$(gcloud secrets versions access latest --secret="anthropic-api-key"),"
    env_vars+="AWS_ACCESS_KEY_ID=$(gcloud secrets versions access latest --secret="aws-access-key-id"),"
    env_vars+="AWS_SECRET_ACCESS_KEY=$(gcloud secrets versions access latest --secret="aws-secret-access-key"),"
    env_vars+="AWS_REGION=ap-south-1,"
    env_vars+="AWS_S3_BUCKET=resume-tailor-dev-bucket,"
    env_vars+="CACHE_TTL=1800000,"
    env_vars+="MAX_CACHE_SIZE=1000,"
    env_vars+="PDF_TIMEOUT=15000,"
    env_vars+="MAX_FILE_SIZE=5242880"
    
    # Remove trailing comma
    env_vars=${env_vars%,}
    
    # Deploy with comprehensive configuration
    gcloud run deploy "$SERVICE_NAME" \
        --image="$DEPLOYMENT_IMAGE" \
        --region="$REGION" \
        --platform=managed \
        --allow-unauthenticated \
        --memory="$MEMORY_LIMIT" \
        --cpu="$CPU_LIMIT" \
        --concurrency="$CONCURRENCY" \
        --max-instances="$MAX_INSTANCES" \
        --timeout=900s \
        --no-cpu-throttling \
        --add-cloudsql-instances="${PROJECT_ID}:${REGION}:${DB_INSTANCE}" \
        --service-account="ats-fit-service-account@${PROJECT_ID}.iam.gserviceaccount.com" \
        --set-env-vars="$env_vars" \
        --quiet || {
        log_error "Cloud Run deployment failed"
        exit 1
    }
    
    log_success "Cloud Run deployment completed"
}

# ========================================================================
# Post-deployment Verification
# ========================================================================

verify_deployment() {
    log_header "DEPLOYMENT VERIFICATION"
    
    # Get service URL
    local service_url
    service_url=$(gcloud run services describe "$SERVICE_NAME" \
        --region="$REGION" \
        --format="value(status.url)")
    
    if [ -z "$service_url" ]; then
        log_error "Failed to retrieve service URL"
        exit 1
    fi
    
    log_info "Service URL: $service_url"
    
    # Wait for service to be ready
    log_info "Waiting for service to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$service_url" >/dev/null 2>&1; then
            log_success "Service is responding"
            break
        else
            log_info "Attempt $attempt/$max_attempts - Service not ready yet..."
            sleep 10
            ((attempt++))
        fi
    done
    
    if [ $attempt -gt $max_attempts ]; then
        log_warning "Service might not be fully ready, but deployment completed"
    fi
    
    # Test basic connectivity
    log_info "Testing service connectivity..."
    local response
    response=$(curl -s "$service_url" || echo "failed")
    
    if [[ "$response" == *"error"* ]] && [[ "$response" == *"404"* ]]; then
        log_success "Service is running (404 is expected for root path)"
    else
        log_warning "Unexpected response from service"
    fi
    
    export SERVICE_URL="$service_url"
}

# ========================================================================
# Cleanup & Summary
# ========================================================================

cleanup() {
    log_header "CLEANUP"
    
    log_info "Cleaning up local Docker images..."
    
    # Remove build cache (optional)
    docker image prune -f >/dev/null 2>&1 || true
    
    log_success "Cleanup completed"
}

deployment_summary() {
    log_header "DEPLOYMENT SUMMARY"
    
    echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
    echo ""
    echo -e "${BLUE}📋 Deployment Details:${NC}"
    echo "  • Project ID: $PROJECT_ID"
    echo "  • Service Name: $SERVICE_NAME"
    echo "  • Region: $REGION"
    echo "  • Image Tag: $IMAGE_TAG"
    echo "  • Deployed At: $(date)"
    echo ""
    echo -e "${BLUE}🌐 Service Information:${NC}"
    echo "  • Service URL: $SERVICE_URL"
    echo "  • Memory Limit: $MEMORY_LIMIT"
    echo "  • CPU Limit: $CPU_LIMIT"
    echo "  • Max Instances: $MAX_INSTANCES"
    echo ""
    echo -e "${BLUE}📊 Useful Commands:${NC}"
    echo "  • View logs: gcloud logs tail --service=$SERVICE_NAME"
    echo "  • Service status: gcloud run services describe $SERVICE_NAME --region=$REGION"
    echo "  • Scale service: gcloud run services update $SERVICE_NAME --max-instances=N --region=$REGION"
    echo ""
}

# ========================================================================
# Error Handling
# ========================================================================

handle_error() {
    local exit_code=$?
    log_error "Deployment failed with exit code: $exit_code"
    log_info "Check the logs above for more details"
    exit $exit_code
}

# ========================================================================
# Main Deployment Function
# ========================================================================

main() {
    # Set up error handling
    trap 'handle_error' ERR
    
    log_header "ATS FIT BACKEND - MANUAL DEPLOYMENT"
    log_info "Starting deployment process..."
    log_info "Timestamp: $(date)"
    
    # Execute deployment steps
    pre_deployment_checks
    load_environment_variables
    build_and_push_image
    deploy_to_cloud_run
    verify_deployment
    cleanup
    deployment_summary
    
    log_success "🎉 Deployment process completed successfully!"
}

# ========================================================================
# Script Entry Point
# ========================================================================

# Ensure script is run from project root
if [ ! -f "package.json" ]; then
    log_error "Please run this script from the project root directory"
    exit 1
fi

# Run main function with all arguments
main "$@"