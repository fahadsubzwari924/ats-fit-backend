#!/bin/bash

# ========================================================================
# ATS Fit Backend - Environment Management Script
# ========================================================================
# Description: Manage different deployment environments
# Usage: ./scripts/env-manager.sh [dev|staging|prod] [action]
# ========================================================================

set -euo pipefail

# Colors
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m'

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_usage() {
    echo "Usage: $0 <environment> <action>"
    echo ""
    echo "Environments:"
    echo "  dev      - Development environment"
    echo "  staging  - Staging environment" 
    echo "  prod     - Production environment"
    echo ""
    echo "Actions:"
    echo "  deploy   - Deploy to specified environment"
    echo "  logs     - View logs for environment"
    echo "  status   - Check environment status"
    echo "  scale    - Scale environment resources"
    echo "  rollback - Rollback to previous version"
    echo ""
    echo "Examples:"
    echo "  $0 dev deploy"
    echo "  $0 prod logs"
    echo "  $0 staging status"
}

get_env_config() {
    local env=$1
    
    case $env in
        "dev")
            export PROJECT_ID="ats-fit-backend"
            export REGION="asia-south1"
            export SERVICE_NAME="ats-fit-backend-dev"
            export MAX_INSTANCES="3"
            export MEMORY="1Gi"
            export CPU="1"
            ;;
        "staging")
            export PROJECT_ID="ats-fit-backend"
            export REGION="asia-south1"
            export SERVICE_NAME="ats-fit-backend-staging"
            export MAX_INSTANCES="5"
            export MEMORY="2Gi"
            export CPU="2"
            ;;
        "prod")
            export PROJECT_ID="ats-fit-backend"
            export REGION="asia-south1"
            export SERVICE_NAME="ats-fit-backend"
            export MAX_INSTANCES="10"
            export MEMORY="2Gi"
            export CPU="2"
            ;;
        *)
            log_error "Invalid environment: $env"
            show_usage
            exit 1
            ;;
    esac
}

deploy_environment() {
    local env=$1
    get_env_config "$env"
    
    log_info "Deploying to $env environment..."
    log_info "Service: $SERVICE_NAME"
    log_info "Resources: $MEMORY CPU, $CPU cores, max $MAX_INSTANCES instances"
    
    # Export environment for deploy script
    export ENVIRONMENT="$env"
    
    # Run deployment script
    "$SCRIPT_DIR/deploy.sh"
}

view_logs() {
    local env=$1
    get_env_config "$env"
    
    log_info "Viewing logs for $env environment..."
    gcloud logs tail --service="$SERVICE_NAME" --project="$PROJECT_ID"
}

check_status() {
    local env=$1
    get_env_config "$env"
    
    log_info "Checking status for $env environment..."
    
    gcloud run services describe "$SERVICE_NAME" \
        --region="$REGION" \
        --project="$PROJECT_ID" \
        --format="table(
            metadata.name:label='SERVICE',
            status.url:label='URL',
            status.conditions[0].type:label='STATUS',
            spec.template.spec.containers[0].resources.limits.memory:label='MEMORY',
            spec.template.spec.containers[0].resources.limits.cpu:label='CPU'
        )"
}

scale_service() {
    local env=$1
    get_env_config "$env"
    
    echo -n "Enter max instances (current: $MAX_INSTANCES): "
    read -r new_max_instances
    
    if [[ "$new_max_instances" =~ ^[0-9]+$ ]] && [ "$new_max_instances" -gt 0 ]; then
        log_info "Scaling $env environment to max $new_max_instances instances..."
        
        gcloud run services update "$SERVICE_NAME" \
            --max-instances="$new_max_instances" \
            --region="$REGION" \
            --project="$PROJECT_ID"
        
        log_success "Service scaled successfully"
    else
        log_error "Invalid number of instances"
        exit 1
    fi
}

rollback_service() {
    local env=$1
    get_env_config "$env"
    
    log_info "Getting revision history for $env environment..."
    
    # Get last 5 revisions
    gcloud run revisions list \
        --service="$SERVICE_NAME" \
        --region="$REGION" \
        --project="$PROJECT_ID" \
        --limit=5 \
        --format="table(
            metadata.name:label='REVISION',
            status.conditions[0].lastTransitionTime:label='DEPLOYED',
            spec.containers[0].image:label='IMAGE'
        )"
    
    echo -n "Enter revision name to rollback to: "
    read -r revision_name
    
    if [ -n "$revision_name" ]; then
        log_info "Rolling back to revision: $revision_name"
        
        gcloud run services update-traffic "$SERVICE_NAME" \
            --to-revisions="$revision_name=100" \
            --region="$REGION" \
            --project="$PROJECT_ID"
        
        log_success "Rollback completed successfully"
    else
        log_error "No revision specified"
        exit 1
    fi
}

main() {
    if [ $# -lt 2 ]; then
        show_usage
        exit 1
    fi
    
    local environment=$1
    local action=$2
    
    case $action in
        "deploy")
            deploy_environment "$environment"
            ;;
        "logs")
            view_logs "$environment"
            ;;
        "status")
            check_status "$environment"
            ;;
        "scale")
            scale_service "$environment"
            ;;
        "rollback")
            rollback_service "$environment"
            ;;
        *)
            log_error "Invalid action: $action"
            show_usage
            exit 1
            ;;
    esac
}

main "$@"