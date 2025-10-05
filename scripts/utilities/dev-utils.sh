#!/bin/bash

# ========================================================================
# ATS Fit Backend - Development Utilities
# ========================================================================
# Description: Development and debugging utilities
# Usage: ./scripts/dev-utils.sh [action]
# ========================================================================

set -euo pipefail

# Colors
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
    echo "Usage: $0 <action>"
    echo ""
    echo "Actions:"
    echo "  test-api     - Test API endpoints"
    echo "  check-health - Check service health"
    echo "  view-metrics - View service metrics"
    echo "  debug-logs   - View detailed logs with filtering"
    echo "  cleanup      - Clean up local resources"
    echo "  validate     - Validate configuration"
    echo ""
}

test_api_endpoints() {
    local base_url="https://ats-fit-backend-345981571037.asia-south1.run.app"
    
    log_info "Testing API endpoints..."
    
    # Test basic connectivity
    log_info "Testing basic connectivity..."
    local status_code
    status_code=$(curl -s -o /dev/null -w "%{http_code}" "$base_url/" || echo "000")
    
    if [ "$status_code" = "404" ]; then
        log_success "✅ Service is responding (404 expected for root path)"
    else
        log_warning "⚠️  Unexpected status code: $status_code"
    fi
    
    # Test different endpoints
    local endpoints=(
        "/"
        "/health"
        "/api"
    )
    
    for endpoint in "${endpoints[@]}"; do
        log_info "Testing endpoint: $endpoint"
        local response
        response=$(curl -s "$base_url$endpoint" 2>/dev/null || echo "failed")
        
        if [[ "$response" == *"error"* ]]; then
            log_info "  Response: API error format (expected)"
        elif [[ "$response" == "failed" ]]; then
            log_warning "  Response: Connection failed"
        else
            log_info "  Response: ${response:0:100}..."
        fi
    done
}

check_service_health() {
    log_info "Checking service health..."
    
    gcloud run services describe "ats-fit-backend" \
        --region="asia-south1" \
        --format="yaml(status.conditions,status.latestReadyRevisionName,status.url)"
}

view_service_metrics() {
    log_info "Viewing service metrics..."
    
    log_info "Recent deployments:"
    gcloud run revisions list \
        --service="ats-fit-backend" \
        --region="asia-south1" \
        --limit=5 \
        --format="table(
            metadata.name:label='REVISION',
            status.conditions[0].lastTransitionTime:label='DEPLOYED',
            status.conditions[0].status:label='STATUS',
            spec.containers[0].resources.limits.memory:label='MEMORY'
        )"
    
    log_info "Traffic allocation:"
    gcloud run services describe "ats-fit-backend" \
        --region="asia-south1" \
        --format="table(
            status.traffic[].revisionName:label='REVISION',
            status.traffic[].percent:label='TRAFFIC_%'
        )"
}

debug_logs() {
    log_info "Viewing debug logs with filtering options..."
    
    echo "Log filtering options:"
    echo "1. All logs"
    echo "2. Error logs only"
    echo "3. Last 1 hour"
    echo "4. Last 24 hours"
    echo "5. Custom filter"
    
    read -p "Choose option (1-5): " choice
    
    local filter=""
    local since=""
    
    case $choice in
        "1")
            filter=""
            ;;
        "2")
            filter="severity>=ERROR"
            ;;
        "3")
            since="--since=1h"
            ;;
        "4")
            since="--since=24h"
            ;;
        "5")
            read -p "Enter custom filter: " custom_filter
            filter="$custom_filter"
            ;;
        *)
            log_error "Invalid choice"
            return 1
            ;;
    esac
    
    local cmd="gcloud logs tail --service=ats-fit-backend"
    
    if [ -n "$filter" ]; then
        cmd="$cmd --filter='$filter'"
    fi
    
    if [ -n "$since" ]; then
        cmd="$cmd $since"
    fi
    
    log_info "Running: $cmd"
    eval "$cmd"
}

cleanup_resources() {
    log_info "Cleaning up local resources..."
    
    # Clean Docker images
    log_info "Cleaning Docker images..."
    docker image prune -f >/dev/null 2>&1 || true
    
    # Clean temporary files
    log_info "Cleaning temporary files..."
    rm -f .env.migration .env.db cloud-sql-proxy 2>/dev/null || true
    
    # Clean npm cache
    log_info "Cleaning npm cache..."
    npm cache clean --force >/dev/null 2>&1 || true
    
    log_success "Cleanup completed"
}

validate_configuration() {
    log_info "Validating configuration..."
    
    # Check required files
    local required_files=("package.json" "Dockerfile" "src/main.ts")
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            log_success "✅ $file exists"
        else
            log_error "❌ $file missing"
        fi
    done
    
    # Check secrets
    log_info "Checking secrets availability..."
    local secrets=("database-password" "jwt-secret" "openai-api-key")
    for secret in "${secrets[@]}"; do
        if gcloud secrets describe "$secret" >/dev/null 2>&1; then
            log_success "✅ Secret '$secret' exists"
        else
            log_error "❌ Secret '$secret' missing"
        fi
    done
    
    # Check GCP resources
    log_info "Checking GCP resources..."
    if gcloud sql instances describe "ats-fit-postgres" >/dev/null 2>&1; then
        log_success "✅ Cloud SQL instance exists"
    else
        log_error "❌ Cloud SQL instance missing"
    fi
    
    if gcloud redis instances describe "ats-fit-redis" --region="asia-south1" >/dev/null 2>&1; then
        log_success "✅ Redis instance exists"
    else
        log_error "❌ Redis instance missing"
    fi
    
    if gcloud run services describe "ats-fit-backend" --region="asia-south1" >/dev/null 2>&1; then
        log_success "✅ Cloud Run service exists"
    else
        log_error "❌ Cloud Run service missing"
    fi
}

main() {
    if [ $# -lt 1 ]; then
        show_usage
        exit 1
    fi
    
    local action=$1
    
    case $action in
        "test-api")
            test_api_endpoints
            ;;
        "check-health")
            check_service_health
            ;;
        "view-metrics")
            view_service_metrics
            ;;
        "debug-logs")
            debug_logs
            ;;
        "cleanup")
            cleanup_resources
            ;;
        "validate")
            validate_configuration
            ;;
        *)
            log_error "Invalid action: $action"
            show_usage
            exit 1
            ;;
    esac
}

main "$@"