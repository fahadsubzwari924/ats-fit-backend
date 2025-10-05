#!/bin/bash

# ========================================================================
# ATS Fit Backend - Database Management Script
# ========================================================================
# Description: Database operations for different environments
# Usage: ./scripts/db-manager.sh [action] [environment]
# ========================================================================

set -euo pipefail

# Colors
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# Configuration
readonly PROJECT_ID="ats-fit-backend"
readonly REGION="asia-south1"
readonly DB_INSTANCE="ats-fit-postgres"
readonly DB_NAME="ats_fit"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
    echo "Usage: $0 <action> [environment]"
    echo ""
    echo "Actions:"
    echo "  migrate     - Run database migrations"
    echo "  seed        - Run database seeding"
    echo "  backup      - Create database backup"
    echo "  restore     - Restore from backup"
    echo "  connect     - Connect to database"
    echo "  status      - Check database status"
    echo "  logs        - View database logs"
    echo ""
    echo "Environment (optional, defaults to current):"
    echo "  dev, staging, prod"
    echo ""
    echo "Examples:"
    echo "  $0 migrate"
    echo "  $0 seed prod"
    echo "  $0 backup"
}

setup_proxy() {
    log_info "Setting up Cloud SQL Proxy..."
    
    if [ ! -f "./cloud-sql-proxy" ]; then
        log_info "Downloading Cloud SQL Proxy..."
        curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.11.0/cloud-sql-proxy.darwin.amd64
        chmod +x cloud-sql-proxy
    fi
    
    # Check if proxy is already running
    if lsof -i :5433 >/dev/null 2>&1; then
        log_info "Cloud SQL Proxy already running on port 5433"
        return 0
    fi
    
    # Start proxy in background
    ./cloud-sql-proxy "$PROJECT_ID:$REGION:$DB_INSTANCE" --port 5433 &
    PROXY_PID=$!
    
    # Wait for proxy to be ready
    sleep 5
    
    if ! lsof -i :5433 >/dev/null 2>&1; then
        log_error "Failed to start Cloud SQL Proxy"
        exit 1
    fi
    
    log_success "Cloud SQL Proxy started (PID: $PROXY_PID)"
    export PROXY_PID
}

create_env_file() {
    log_info "Creating environment file for database operations..."
    
    local db_password
    db_password=$(gcloud secrets versions access latest --secret="database-password")
    
    cat > .env.db << EOF
NODE_ENV=production
DATABASE_HOST=localhost
DATABASE_PORT=5433
DATABASE_NAME=$DB_NAME
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=$db_password
REDIS_HOST=10.70.241.139
REDIS_PORT=6379
REDIS_PASSWORD=redis_password
JWT_SECRET=$(gcloud secrets versions access latest --secret="jwt-secret" 2>/dev/null || echo "PLACEHOLDER_JWT_SECRET")
JWT_EXPIRES_IN=24h
EOF
    
    log_success "Environment file created"
}

run_migrations() {
    log_info "Running database migrations..."
    
    setup_proxy
    create_env_file
    
    env $(cat .env.db | xargs) npm run migration:run
    
    log_success "Migrations completed successfully"
    cleanup
}

run_seeding() {
    log_info "Running database seeding..."
    
    setup_proxy
    create_env_file
    
    log_info "Seeding resume templates..."
    env $(cat .env.db | xargs) npm run seed:resume-templates
    
    log_info "Seeding rate limits..."
    env $(cat .env.db | xargs) npm run seed:rate-limits
    
    log_success "Seeding completed successfully"
    cleanup
}

create_backup() {
    local backup_name="backup-$(date +%Y%m%d-%H%M%S)"
    
    log_info "Creating database backup: $backup_name"
    
    gcloud sql export sql "$DB_INSTANCE" "gs://$PROJECT_ID-backups/$backup_name.sql" \
        --database="$DB_NAME" \
        --project="$PROJECT_ID"
    
    log_success "Backup created: gs://$PROJECT_ID-backups/$backup_name.sql"
}

restore_backup() {
    log_warning "This will overwrite the current database!"
    echo -n "Enter backup file name (without .sql extension): "
    read -r backup_name
    
    if [ -n "$backup_name" ]; then
        log_info "Restoring from backup: $backup_name"
        
        gcloud sql import sql "$DB_INSTANCE" "gs://$PROJECT_ID-backups/$backup_name.sql" \
            --database="$DB_NAME" \
            --project="$PROJECT_ID"
        
        log_success "Database restored successfully"
    else
        log_error "No backup file specified"
        exit 1
    fi
}

connect_database() {
    log_info "Connecting to database..."
    
    setup_proxy
    create_env_file
    
    local db_password
    db_password=$(gcloud secrets versions access latest --secret="database-password")
    
    log_info "Connection details:"
    log_info "Host: localhost"
    log_info "Port: 5433" 
    log_info "Database: $DB_NAME"
    log_info "Username: postgres"
    
    PGPASSWORD="$db_password" psql -h localhost -p 5433 -U postgres -d "$DB_NAME"
    
    cleanup
}

check_database_status() {
    log_info "Checking database status..."
    
    gcloud sql instances describe "$DB_INSTANCE" \
        --project="$PROJECT_ID" \
        --format="table(
            name:label='INSTANCE',
            state:label='STATE',
            databaseVersion:label='VERSION',
            region:label='REGION',
            settings.tier:label='TIER'
        )"
    
    # Check database size
    log_info "Database information:"
    gcloud sql databases list --instance="$DB_INSTANCE" --project="$PROJECT_ID"
}

view_database_logs() {
    log_info "Viewing database logs..."
    
    gcloud logging read "resource.type=cloudsql_database AND resource.labels.database_id=$PROJECT_ID:$DB_INSTANCE" \
        --limit=50 \
        --format="table(timestamp,severity,textPayload)" \
        --project="$PROJECT_ID"
}

cleanup() {
    if [ -n "${PROXY_PID:-}" ]; then
        log_info "Stopping Cloud SQL Proxy (PID: $PROXY_PID)..."
        kill "$PROXY_PID" 2>/dev/null || true
    fi
    
    # Clean up environment file
    rm -f .env.db
    
    log_success "Cleanup completed"
}

# Trap cleanup on exit
trap cleanup EXIT

main() {
    if [ $# -lt 1 ]; then
        show_usage
        exit 1
    fi
    
    local action=$1
    
    case $action in
        "migrate")
            run_migrations
            ;;
        "seed")
            run_seeding
            ;;
        "backup")
            create_backup
            ;;
        "restore")
            restore_backup
            ;;
        "connect")
            connect_database
            ;;
        "status")
            check_database_status
            ;;
        "logs")
            view_database_logs
            ;;
        *)
            log_error "Invalid action: $action"
            show_usage
            exit 1
            ;;
    esac
}

main "$@"