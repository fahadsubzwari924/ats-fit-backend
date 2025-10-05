#!/bin/bash

# ========================================================================
# ATS Fit Backend - Cloud SQL Proxy Starter
# ========================================================================
# Description: Single command to start Cloud SQL Proxy for production DB access
# Usage: ./start-proxy.sh [--no-cleanup]
# Options:
#   --no-cleanup    Skip killing existing proxy instances (faster if already clean)
# ========================================================================

set -euo pipefail

# Parse command line arguments
SKIP_CLEANUP=false
for arg in "$@"; do
    case $arg in
        --no-cleanup)
            SKIP_CLEANUP=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--no-cleanup]"
            echo "  --no-cleanup    Skip killing existing proxy instances"
            exit 0
            ;;
        *)
            # Unknown option
            ;;
    esac
done

# Colors
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly RED='\033[0;31m'
readonly NC='\033[0m'

# Configuration
readonly PROJECT_ID="ats-fit-backend"
readonly REGION="asia-south1"
readonly DB_INSTANCE="ats-fit-postgres"
readonly PROXY_PORT="5434"
readonly CONNECTION_STRING="$PROJECT_ID:$REGION:$DB_INSTANCE"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if Cloud SQL Proxy exists
check_proxy_binary() {
    if [ ! -f "./cloud-sql-proxy" ]; then
        log_info "Cloud SQL Proxy not found. Downloading..."
        curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.11.0/cloud-sql-proxy.darwin.amd64
        chmod +x cloud-sql-proxy
        log_success "Cloud SQL Proxy downloaded and made executable"
    else
        log_success "Cloud SQL Proxy binary found"
    fi
}

# Kill existing proxy instances and clean up
cleanup_existing_proxy() {
    log_info "Checking for existing Cloud SQL Proxy instances..."
    
    # Kill all cloud-sql-proxy processes
    if pgrep -f "cloud-sql-proxy" >/dev/null; then
        log_warning "Found existing Cloud SQL Proxy processes. Stopping them..."
        pkill -f "cloud-sql-proxy" 2>/dev/null || true
        sleep 3
        
        # Force kill if still running
        if pgrep -f "cloud-sql-proxy" >/dev/null; then
            log_warning "Force killing stubborn proxy processes..."
            pkill -9 -f "cloud-sql-proxy" 2>/dev/null || true
            sleep 2
        fi
        
        log_success "Previous proxy instances stopped"
    else
        log_success "No existing proxy instances found"
    fi
    
    # Check if port is still occupied by other processes
    if lsof -i :$PROXY_PORT >/dev/null 2>&1; then
        log_warning "Port $PROXY_PORT is still occupied by another process!"
        echo "   Process details:"
        lsof -i :$PROXY_PORT
        echo ""
        log_error "Please stop the process using port $PROXY_PORT and try again"
        echo "   You can use: kill <PID> or lsof -ti:$PROXY_PORT | xargs kill"
        exit 1
    fi
    
    log_success "Port $PROXY_PORT is now available"
}

# Start the proxy
start_proxy() {
    log_info "Starting Cloud SQL Proxy..."
    log_info "Connection: $CONNECTION_STRING"
    log_info "Local Port: $PROXY_PORT"
    
    # Start proxy in background
    nohup ./cloud-sql-proxy "$CONNECTION_STRING" --port "$PROXY_PORT" >/dev/null 2>&1 &
    PROXY_PID=$!
    
    # Wait a moment for startup
    sleep 3
    
    # Check if it started successfully
    if kill -0 $PROXY_PID 2>/dev/null; then
        log_success "Cloud SQL Proxy started successfully!"
        log_success "Process ID: $PROXY_PID"
        
        echo ""
        echo "🔐 Retrieving database password..."
        DB_PASSWORD=$(gcloud secrets versions access latest --secret="database-password" 2>/dev/null || echo "Failed to get password")
        
        if [ "$DB_PASSWORD" != "Failed to get password" ]; then
            log_success "Database password retrieved!"
            
            # Copy to clipboard if available
            if command -v pbcopy >/dev/null 2>&1; then
                echo -n "$DB_PASSWORD" | pbcopy
                log_success "Password copied to clipboard!"
            fi
        else
            log_warning "Could not retrieve password from Secret Manager"
            DB_PASSWORD="[Run: gcloud secrets versions access latest --secret=\"database-password\"]"
        fi
        
        echo ""
        echo "🎯 Complete pgAdmin Connection Settings:"
        echo "   Server Name: ATS Fit Production DB"
        echo "   Host: 127.0.0.1"
        echo "   Port: $PROXY_PORT"
        echo "   Database: ats_fit"
        echo "   Username: postgres"
        echo "   Password: $DB_PASSWORD"
        echo ""
        echo "� Quick Commands:"
        echo "   🛑 Stop proxy: pkill cloud-sql-proxy (or make proxy-stop)"
        echo "   🔄 Restart: ./start-proxy.sh (or npm run db:proxy)"
        echo "   ⚡ Fast restart: ./start-proxy.sh --no-cleanup"
        echo ""
        echo "💡 Tip: Password is copied to clipboard and proxy runs in background"
        
    else
        log_error "Failed to start Cloud SQL Proxy"
        exit 1
    fi
}

# Test proxy connection
test_connection() {
    log_info "Testing database connection..."
    
    # Get password for testing
    local test_password
    test_password=$(gcloud secrets versions access latest --secret="database-password" 2>/dev/null || echo "")
    
    if [ -n "$test_password" ] && command -v psql >/dev/null 2>&1; then
        if timeout 10 bash -c "PGPASSWORD='$test_password' psql -h 127.0.0.1 -p $PROXY_PORT -U postgres -d ats_fit -c 'SELECT 1;' >/dev/null 2>&1"; then
            log_success "Database connection test successful!"
        else
            log_warning "Database connection test failed (but proxy is running)"
        fi
    else
        log_info "Skipping connection test (psql not available or password not retrieved)"
    fi
}

# Main execution
main() {
    echo "🚀 ATS Fit - Cloud SQL Proxy Starter (Smart Restart)"
    echo "=================================================="
    echo ""
    
    check_proxy_binary
    
    if [ "$SKIP_CLEANUP" = false ]; then
        cleanup_existing_proxy
    else
        log_info "Skipping cleanup (--no-cleanup flag used)"
    fi
    
    start_proxy
    test_connection
}

main "$@"