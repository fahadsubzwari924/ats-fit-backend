#!/usr/bin/env bash

# ========================================================================
# ATS Fit Backend - Manual Deployment Script
# ========================================================================
# Requires: bash 4.0+ (for associative arrays)
# Usage: deploy.sh [environment]
#   environment: dev, staging, or prod (default: prod)
# ========================================================================

# Check bash version
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo "ERROR: This script requires bash 4.0 or higher"
    echo "Current version: ${BASH_VERSION}"
    echo "On macOS, install with: brew install bash"
    echo "Then update your PATH or run with: /opt/homebrew/bin/bash $0"
    exit 1
fi
# Description: Complete manual deployment script for Google Cloud Run
# Author: ATS Fit Team
# Version: 1.0.0
# Last Updated: $(date)
# ========================================================================

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# ========================================================================
# Fix gcloud Python environment
# ========================================================================
# Unset conda/anaconda Python variables that interfere with gcloud
unset CLOUDSDK_PYTHON 2>/dev/null || true
unset CONDA_PYTHON_EXE 2>/dev/null || true
unset PYTHONPATH 2>/dev/null || true

# ========================================================================
# Configuration & Constants
# ========================================================================

# Environment selection (accept as first argument)
readonly DEPLOY_ENVIRONMENT="${1:-prod}"

# Validate environment
if [[ ! "$DEPLOY_ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo "ERROR: Invalid environment '$DEPLOY_ENVIRONMENT'"
    echo "Usage: $0 [dev|staging|prod]"
    exit 1
fi

# Project Configuration
# Default project id (fallback). We prefer an explicit env var, then gcloud config, then this default.
DEFAULT_PROJECT_ID="ats-fit-backend"
# Allow overriding PROJECT_ID via environment (useful in CI or when deploying to multiple GCP projects)
if [ -n "${PROJECT_ID:-}" ]; then
    # honor already-set PROJECT_ID from environment
    :
else
    # try to read from gcloud config (if available), otherwise fall back to default
    if command -v gcloud >/dev/null 2>&1; then
        PROJECT_ID_FROM_GCLOUD=$(gcloud config get-value project 2>/dev/null || echo "")
        if [ -n "$PROJECT_ID_FROM_GCLOUD" ]; then
            PROJECT_ID="$PROJECT_ID_FROM_GCLOUD"
        else
            PROJECT_ID="$DEFAULT_PROJECT_ID"
        fi
    else
        PROJECT_ID="$DEFAULT_PROJECT_ID"
    fi
fi
readonly PROJECT_ID
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

sync_and_load_environment() {
    log_header "ENVIRONMENT SYNCHRONIZATION"
    
    # Run env-sync script to sync environment file to Secret Manager
    local sync_script="$(dirname "${BASH_SOURCE[0]}")/env-sync.sh"
    
    if [ ! -f "$sync_script" ]; then
        log_error "env-sync.sh not found: $sync_script"
        exit 1
    fi
    
    log_info "Syncing environment variables from src/config/.env.${DEPLOY_ENVIRONMENT} to Secret Manager..."
    
    # Execute env-sync.sh with environment parameter and capture the output
    local sync_output
    sync_output=$(/opt/homebrew/bin/bash "$sync_script" "$DEPLOY_ENVIRONMENT" 2>&1)
    
    # Check if sync was successful
    if [ $? -ne 0 ]; then
        log_error "Environment synchronization failed"
        echo "$sync_output"
        exit 1
    fi
    
    # Parse the output to populate ENV_VARS and SECRET_VARS arrays
    declare -gA ENV_VARS
    declare -gA SECRET_VARS
    
    while IFS= read -r line; do
        if [[ "$line" =~ ^ENV_([^=]+)=(.*)$ ]]; then
            ENV_VARS["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        elif [[ "$line" =~ ^SECRET_([^=]+)=(.*)$ ]]; then
            SECRET_VARS["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        fi
    done <<< "$sync_output"
    
    log_success "Environment synchronization completed: ${#ENV_VARS[@]} regular, ${#SECRET_VARS[@]} secrets"
}

load_environment_variables() {
    log_header "ENVIRONMENT CONFIGURATION"
    log_info "Loading environment variables from secrets..."
    
    # Redis configuration
    local redis_host
    redis_host=$(gcloud redis instances describe "$REDIS_INSTANCE" --region="$REGION" --format="value(host)" 2>/dev/null || echo "")
    
    if [ -z "$redis_host" ]; then
        log_error "Failed to retrieve Redis host"
        exit 1
    fi
    
    # Store in deployment variables
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
    
    log_info "Building Docker image with BuildKit optimizations..."
    log_info "Image tag: $IMAGE_TAG"
    
    # Configure Docker for GCR FIRST (needed for cache pull)
    log_info "Configuring Docker for Google Container Registry..."
    gcloud auth configure-docker gcr.io --quiet
    
    # Enable Docker BuildKit for faster builds
    export DOCKER_BUILDKIT=1
    
    # Try to pull latest image for layer caching (ignore failures if image doesn't exist yet)
    log_info "Pulling latest image for cache reuse..."
    local cache_available=false
    if docker pull "${latest_url}" 2>/dev/null; then
        log_success "Previous image found - will use cached layers"
        cache_available=true
    else
        log_warning "No previous image found - this will be a full build (normal for first deployment)"
    fi
    
    # Build with BuildKit, proper caching, and multi-stage optimization
    log_info "Building for Cloud Run (linux/amd64 platform)..."
    
    # Build arguments
    local build_args=(
        "--platform" "linux/amd64"
        "--target" "production"
        "--tag" "${image_url}"
        "--tag" "${latest_url}"
        "--build-arg" "BUILDKIT_INLINE_CACHE=1"
        "--progress=plain"
    )
    
    # Add cache-from only if previous image exists
    if [ "$cache_available" = true ]; then
        build_args+=("--cache-from" "${latest_url}")
    fi
    
    docker build "${build_args[@]}" . || {
        log_error "Docker build failed"
        exit 1
    }
    
    log_success "Docker image built successfully"
    
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
# Run Database Migrations
# ========================================================================

run_migrations() {
    log_header "RUNNING DATABASE MIGRATIONS"
    
    log_info "Fetching database credentials..."
    local db_user db_pass
    db_user=$(gcloud secrets versions access latest --secret="database-username" --project="$PROJECT_ID" 2>/dev/null)
    db_pass=$(gcloud secrets versions access latest --secret="database-password" --project="$PROJECT_ID" 2>/dev/null)
    
    if [ -z "$db_user" ] || [ -z "$db_pass" ]; then
        log_error "Failed to fetch database credentials from Secret Manager"
        exit 1
    fi
    
    # Check if cloud-sql-proxy is installed
    if ! command -v cloud-sql-proxy &> /dev/null; then
        log_warning "Cloud SQL Proxy not found. Installing..."
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            if [[ "$(uname -m)" == "arm64" ]]; then
                curl -o /tmp/cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.darwin.arm64
            else
                curl -o /tmp/cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.darwin.amd64
            fi
        else
            # Linux
            curl -o /tmp/cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.linux.amd64
        fi
        chmod +x /tmp/cloud-sql-proxy
        sudo mv /tmp/cloud-sql-proxy /usr/local/bin/cloud-sql-proxy
        log_success "Cloud SQL Proxy installed"
    fi
    
    log_info "Starting Cloud SQL Proxy..."
    local connection_name="${PROJECT_ID}:${REGION}:${DB_INSTANCE}"
    local proxy_port=5434
    
    # Start proxy in background
    cloud-sql-proxy --port=$proxy_port "${connection_name}" > /tmp/cloud-sql-proxy.log 2>&1 &
    local proxy_pid=$!
    
    # Wait for proxy to be ready
    log_info "Waiting for Cloud SQL Proxy to be ready..."
    sleep 3
    
    # Check if proxy started successfully
    if ! kill -0 $proxy_pid 2>/dev/null; then
        log_error "Cloud SQL Proxy failed to start. Check /tmp/cloud-sql-proxy.log"
        cat /tmp/cloud-sql-proxy.log
        exit 1
    fi
    
    log_info "Running TypeORM migrations..."
    
    # Set environment variables for TypeORM
    export DATABASE_HOST=localhost
    export DATABASE_PORT=$proxy_port
    export DATABASE_USERNAME="$db_user"
    export DATABASE_PASSWORD="$db_pass"
    export DATABASE_NAME="$DB_NAME"
    export NODE_ENV=production
    
    # Run migrations
    if npm run migration:run; then
        log_success "Migrations completed successfully"
    else
        log_error "Migrations failed"
        kill $proxy_pid 2>/dev/null || true
        exit 1
    fi
    
    # Stop proxy
    log_info "Stopping Cloud SQL Proxy..."
    kill $proxy_pid 2>/dev/null || true
    
    log_success "Database migrations completed"
}

# ========================================================================
# Deploy to Cloud Run
# ========================================================================

deploy_to_cloud_run() {
    log_header "DEPLOYING TO CLOUD RUN"
    
    log_info "Deploying service: $SERVICE_NAME"
    log_info "Region: $REGION"
    log_info "Image: $DEPLOYMENT_IMAGE"
    
    # Build environment variables dynamically from synced configuration
    log_info "Building environment variables from synced configuration..."
    
    local env_vars=""
    
    # Add regular environment variables (parsed from .env.prod)
    for key in "${!ENV_VARS[@]}"; do
        # Skip PORT - it's reserved and automatically set by Cloud Run
        if [ "$key" = "PORT" ]; then
            continue
        fi
        
        local value="${ENV_VARS[$key]}"
        
        # Apply production overrides for specific variables
        case "$key" in
            NODE_ENV)
                value="production"
                ;;
            DATABASE_HOST)
                value="/cloudsql/${PROJECT_ID}:${REGION}:${DB_INSTANCE}"
                ;;
            DATABASE_PORT)
                value="5432"
                ;;
            REDIS_PORT)
                value="6379"
                ;;
            APP_URL)
                # Get current service URL or use default
                value=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="value(status.url)" 2>/dev/null || echo "https://ats-fit-backend-345981571037.asia-south1.run.app")
                ;;
        esac
        
        env_vars+="${key}=${value},"
    done
    
    # Build secret references for Cloud Run
    local secret_refs=""
    for key in "${!SECRET_VARS[@]}"; do
        # SECRET_VARS already contains the secret name (e.g., "lemon-squeezy-api-key")
        local secret_name="${SECRET_VARS[$key]}"
        
        # Format: ENV_VAR_NAME=secret-name:latest
        if [ -n "$secret_refs" ]; then
            secret_refs+=","
        fi
        secret_refs+="${key}=${secret_name}:latest"
    done
    
    # Remove trailing comma from env_vars
    env_vars=${env_vars%,}
    
    log_success "Environment variables built: ${#ENV_VARS[@]} regular + ${#SECRET_VARS[@]} secrets"
    
    # Deploy with comprehensive configuration
    gcloud run deploy "$SERVICE_NAME" \
        --image="$DEPLOYMENT_IMAGE" \
        --region="$REGION" \
        --platform=managed \
        --allow-unauthenticated \
        --port=8080 \
        --memory="$MEMORY_LIMIT" \
        --cpu="$CPU_LIMIT" \
        --concurrency="$CONCURRENCY" \
        --max-instances="$MAX_INSTANCES" \
        --timeout=900s \
        --no-cpu-throttling \
        --add-cloudsql-instances="${PROJECT_ID}:${REGION}:${DB_INSTANCE}" \
        --vpc-connector="ats-fit-connector" \
        --vpc-egress="private-ranges-only" \
        --service-account="ats-fit-service-account@${PROJECT_ID}.iam.gserviceaccount.com" \
        --set-env-vars="$env_vars" \
        --update-secrets="$secret_refs" \
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
    local health_url="${service_url}/health"
    
    while [ $attempt -le $max_attempts ]; do
        # Check if service responds (any HTTP response, even 404, means it's running)
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" "$health_url" 2>/dev/null || echo "000")
        
        if [ "$http_code" != "000" ] && [ "$http_code" != "502" ] && [ "$http_code" != "503" ]; then
            log_success "Service is responding (HTTP $http_code)"
            break
        else
            log_info "Attempt $attempt/$max_attempts - Service not ready yet (HTTP $http_code)..."
            sleep 10
            ((attempt++))
        fi
    done
    
    if [ $attempt -gt $max_attempts ]; then
        log_warning "Service might not be fully ready, but deployment completed"
    fi
    
    # Test basic connectivity
    log_info "Testing service connectivity..."
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" "$service_url" 2>/dev/null || echo "000")
    
    if [ "$response_code" = "404" ]; then
        log_success "Service is running (404 is normal for root path)"
    elif [ "$response_code" = "200" ]; then
        log_success "Service is running and responding with 200 OK"
    else
        log_warning "Service returned HTTP $response_code"
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
    sync_and_load_environment  # Auto-sync .env to Secret Manager
    load_environment_variables
    build_and_push_image
    run_migrations             # Run database migrations before deploying
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