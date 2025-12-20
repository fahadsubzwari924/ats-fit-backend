#!/usr/bin/env bash

# ========================================================================
# Environment Variables Auto-Sync Script
# ========================================================================
# Description: Automatically syncs .env.prod variables to Secret Manager
# Author: ATS Fit Team
# Version: 1.0.0
# Requires: bash 4.0+ (for associative arrays)
# ========================================================================

set -euo pipefail

# Fix gcloud Python environment - unset conda variables
unset CLOUDSDK_PYTHON 2>/dev/null || true
unset CONDA_PYTHON_EXE 2>/dev/null || true
unset PYTHONPATH 2>/dev/null || true

# Check bash version
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo "ERROR: This script requires bash 4.0 or higher"
    echo "Current version: ${BASH_VERSION}"
    echo "On macOS, install with: brew install bash"
    echo "Then run with: /usr/local/bin/bash $0"
    exit 1
fi

# ========================================================================
# Configuration
# ========================================================================

# Accept environment as first argument (dev, staging, prod)
readonly ENVIRONMENT="${1:-prod}"
readonly PROJECT_ID="${PROJECT_ID:-ats-fit-backend}"
readonly ENV_FILE="src/config/.env.${ENVIRONMENT}"
readonly SECRETS_PREFIX=""  # Optional prefix for secret names

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# ========================================================================
# Utility Functions
# ========================================================================

log_info() {
    echo -e "${BLUE}[ENV-SYNC]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[ENV-SYNC]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[ENV-SYNC]${NC} $1"
}

log_error() {
    echo -e "${RED}[ENV-SYNC]${NC} $1"
}

# ========================================================================
# Secret Management - Determine which variables should be secrets
# ========================================================================

should_be_secret() {
    local key="$1"
    
    # Variables that should be stored as secrets (sensitive data)
    case "$key" in
        *PASSWORD*|*SECRET*|*KEY*|*TOKEN*|*API_KEY*)
            return 0  # true - should be secret
            ;;
        DATABASE_USERNAME|REDIS_HOST)
            return 0  # true - should be secret
            ;;
        *)
            return 1  # false - regular env var
            ;;
    esac
}

# ========================================================================
# Parse .env.prod file
# ========================================================================

parse_env_file() {
    local env_file="$1"
    
    if [ ! -f "$env_file" ]; then
        log_error "Environment file not found: $env_file"
        exit 1
    fi
    
    log_info "Parsing environment file: $env_file"
    
    # Use Python parser (more reliable than bash for complex files)
    local parser_script="$(dirname "${BASH_SOURCE[0]}")/parse-env.py"
    
    if [ ! -f "$parser_script" ]; then
        log_error "Parser script not found: $parser_script"
        exit 1
    fi
    
    # Use associative arrays to store variables (requires bash 4+)
    declare -gA ENV_VARS
    declare -gA SECRET_VARS
    
    # Parse file and eval the output to populate arrays
    local parse_output
    parse_output=$(python3 "$parser_script" "$env_file" 2>&1)
    
    if [ $? -ne 0 ]; then
        log_error "Failed to parse environment file"
        echo "$parse_output"
        exit 1
    fi
    
    # Extract counts from first line
    local total_vars=$(echo "$parse_output" | head -1 | grep -oE '[0-9]+' | head -1)
    
    # Eval the array assignments (skip comment lines)
    eval "$(echo "$parse_output" | grep -E "^(ENV_VARS|SECRET_VARS)")"
    
    log_success "Parsed $total_vars variables (${#SECRET_VARS[@]} secrets, ${#ENV_VARS[@]} regular)"
}

# ========================================================================
# Sync secrets to Google Secret Manager
# ========================================================================

sync_secrets() {
    log_info "Syncing secrets to Google Secret Manager..."
    log_info "Found ${#SECRET_VARS[@]} secrets to sync"
    
    local created=0
    local updated=0
    local skipped=0
    
    # Temporarily disable strict error handling for this function
    set +e
    
    for key in "${!SECRET_VARS[@]}"; do
        log_info "Processing secret: $key"
        local value="${SECRET_VARS[$key]}"
        local secret_name=$(echo "$key" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
        
        # Use temp file for large values (more reliable than stdin)
        local temp_file=$(mktemp)
        echo -n "$value" > "$temp_file"
        
        # Check if secret exists
        if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
            # Secret exists - always update (simpler and safer)
            log_info "Updating existing secret: $secret_name"
            gcloud secrets versions add "$secret_name" \
                --data-file="$temp_file" \
                --project="$PROJECT_ID" --quiet >/dev/null 2>&1
            local exit_code=$?
            
            if [ $exit_code -eq 0 ]; then
                updated=$((updated + 1))
                log_success "✓ Updated: $secret_name"
            else
                log_warning "Failed to update secret: $secret_name (exit code: $exit_code)"
            fi
        else
            # Create new secret
            log_info "Creating secret: $secret_name"
            gcloud secrets create "$secret_name" \
                --data-file="$temp_file" \
                --replication-policy="automatic" \
                --project="$PROJECT_ID" --quiet >/dev/null 2>&1
            local create_code=$?
            
            if [ $create_code -eq 0 ]; then
                # Grant service account access
                gcloud secrets add-iam-policy-binding "$secret_name" \
                    --member="serviceAccount:ats-fit-service-account@${PROJECT_ID}.iam.gserviceaccount.com" \
                    --role="roles/secretmanager.secretAccessor" \
                    --project="$PROJECT_ID" --quiet >/dev/null 2>&1 || true
                
                created=$((created + 1))
                log_success "✓ Created: $secret_name"
            else
                log_warning "Failed to create secret: $secret_name (exit code: $create_code)"
            fi
        fi
        
        # Clean up temp file
        rm -f "$temp_file"
    done
    
    # Re-enable strict error handling
    set -e
    
    log_success "Secrets synced: $created created, $updated updated, $skipped unchanged"
}

# ========================================================================
# Generate environment variables for Cloud Run deployment
# ========================================================================

generate_env_vars() {
    local output_file="${1:-/tmp/cloud-run-env-vars.txt}"
    
    log_info "Generating Cloud Run environment variables..."
    
    local env_string=""
    
    # Add regular environment variables
    for key in "${!ENV_VARS[@]}"; do
        local value="${ENV_VARS[$key]}"
        
        # Special handling for production overrides
        case "$key" in
            NODE_ENV)
                value="production"
                ;;
            DATABASE_HOST)
                value="/cloudsql/${PROJECT_ID}:asia-south1:ats-fit-postgres"
                ;;
            DATABASE_PORT)
                value="5432"
                ;;
            REDIS_PORT)
                value="6379"
                ;;
            APP_URL)
                # Will be set dynamically after deployment
                value="https://ats-fit-backend-345981571037.asia-south1.run.app"
                ;;
            PORT)
                value="8080"
                ;;
        esac
        
        env_string+="${key}=${value},"
    done
    
    # Add secrets (will be retrieved at runtime)
    for key in "${!SECRET_VARS[@]}"; do
        local secret_name=$(echo "$key" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
        # For gcloud run deploy, we need to use the secret syntax
        env_string+="${key}=\$(gcloud secrets versions access latest --secret=\"${secret_name}\"),"
    done
    
    # Remove trailing comma
    env_string="${env_string%,}"
    
    # Save to file
    echo "$env_string" > "$output_file"
    
    log_success "Environment variables generated: $output_file"
}

# ========================================================================
# Generate shell-eval friendly output for deploy.sh
# ========================================================================

generate_deploy_env() {
    log_info "Generating deployment environment configuration..."
    
    # Output regular env vars
    for key in "${!ENV_VARS[@]}"; do
        local value="${ENV_VARS[$key]}"
        
        # Production overrides
        case "$key" in
            NODE_ENV) value="production" ;;
            DATABASE_HOST) value="/cloudsql/${PROJECT_ID}:asia-south1:ats-fit-postgres" ;;
            DATABASE_PORT) value="5432" ;;
            REDIS_PORT) value="6379" ;;
            APP_URL) value="https://ats-fit-backend-345981571037.asia-south1.run.app" ;;
            PORT) value="8080" ;;
        esac
        
        echo "ENV_${key}=${value}"
    done
    
    # Output secret references
    for key in "${!SECRET_VARS[@]}"; do
        local secret_name=$(echo "$key" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
        echo "SECRET_${key}=${secret_name}"
    done
}

# ========================================================================
# Main execution
# ========================================================================

main() {
    log_info "Starting environment synchronization..."
    log_info "Environment: $ENVIRONMENT"
    log_info "Project: $PROJECT_ID"
    log_info "Environment file: $ENV_FILE"
    
    # Verify environment file exists
    if [ ! -f "$ENV_FILE" ]; then
        log_error "Environment file not found: $ENV_FILE"
        exit 1
    fi
    
    # Parse the environment file
    parse_env_file "$ENV_FILE"
    
    # Sync secrets to Secret Manager
    sync_secrets
    
    # Generate environment variables
    generate_deploy_env
    
    log_success "Environment synchronization completed!"
}

# Run if executed directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
