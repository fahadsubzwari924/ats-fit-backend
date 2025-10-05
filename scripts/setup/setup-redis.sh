#!/bin/bash

# Google Cloud Redis (Memorystore) Setup Script
# This script creates a Redis instance and retrieves its IP address

set -e

PROJECT_ID="ats-fit-backend"
REDIS_INSTANCE_NAME="ats-fit-redis"
REGION="asia-south1"  # Mumbai, India - Best for Pakistan (20-40ms latency)
MEMORY_SIZE="1"  # 1GB memory size (use numeric value only)
REDIS_VERSION="redis_6_x"

echo "🔴 Setting up Redis (Memorystore) for ATS Fit Backend..."
echo "   Project: $PROJECT_ID"
echo "   Instance: $REDIS_INSTANCE_NAME"
echo "   Region: $REGION (Mumbai, India - Optimized for Pakistan)"

# Set the project
gcloud config set project $PROJECT_ID

# Verify project is set correctly
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
    echo "❌ Failed to set project to $PROJECT_ID. Current project: $CURRENT_PROJECT"
    exit 1
fi

# Enable Redis API if not already enabled
echo "📡 Enabling Redis (Memorystore) API..."
gcloud services enable redis.googleapis.com

# Verify the API is enabled (wait a bit for it to propagate)
echo "⏳ Waiting for API to be enabled..."
sleep 10

# Check if Redis instance already exists
echo "🔍 Checking if Redis instance already exists..."
if gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION >/dev/null 2>&1; then
    echo "✅ Redis instance '$REDIS_INSTANCE_NAME' already exists!"
    
    # Get the current status
    STATUS=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(state)")
    echo "   Status: $STATUS"
    
    if [ "$STATUS" = "READY" ]; then
        echo "✅ Redis instance is ready to use!"
    else
        echo "⏳ Redis instance is still being created... Status: $STATUS"
        echo "   Please wait for it to be ready before proceeding."
    fi
else
    echo "🚀 Creating new Redis instance..."
    
    # Create Redis instance
    gcloud redis instances create $REDIS_INSTANCE_NAME \
        --size=$MEMORY_SIZE \
        --region=$REGION \
        --redis-version=$REDIS_VERSION \
        --network=projects/$PROJECT_ID/global/networks/default \
        --connect-mode=DIRECT_PEERING \
        --display-name="ATS Fit Redis Cache"
    
    echo "✅ Redis instance creation initiated!"
    echo "⏳ This may take 5-10 minutes to complete..."
fi

# Wait for the instance to be ready
echo "⏳ Waiting for Redis instance to be ready..."
while true; do
    STATUS=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(state)" 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$STATUS" = "READY" ]; then
        echo "✅ Redis instance is ready!"
        break
    elif [ "$STATUS" = "NOT_FOUND" ]; then
        echo "❌ Redis instance not found. There may have been an error."
        exit 1
    else
        echo "   Current status: $STATUS (waiting...)"
        sleep 30
    fi
done

# Get Redis instance details
echo "📊 Getting Redis instance details..."
REDIS_HOST=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(host)")
REDIS_PORT=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(port)")
REDIS_AUTH=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(authEnabled)")

echo ""
echo "🎉 Redis instance setup completed!"
echo "================================================"
echo "📋 Connection Details:"
echo "   Instance Name: $REDIS_INSTANCE_NAME"
echo "   Host IP: $REDIS_HOST"
echo "   Port: $REDIS_PORT"
echo "   Auth Enabled: $REDIS_AUTH"
echo "   Region: $REGION"
echo "   Memory: ${MEMORY_SIZE}GB"
echo "================================================"

# Update deployment files with Redis IP
echo ""
echo "🔧 Updating deployment files with Redis IP..."

# Update cloudbuild.yaml
if [ -f "cloudbuild.yaml" ]; then
    sed -i.bak "s/your-memorystore-redis-ip/$REDIS_HOST/g" cloudbuild.yaml
    echo "   ✅ Updated cloudbuild.yaml"
else
    echo "   ⚠️  cloudbuild.yaml not found"
fi

# Update cloud-run-service.yaml
if [ -f "cloud-run-service.yaml" ]; then
    sed -i.bak "s/your-memorystore-redis-ip/$REDIS_HOST/g" cloud-run-service.yaml
    echo "   ✅ Updated cloud-run-service.yaml"
else
    echo "   ⚠️  cloud-run-service.yaml not found"
fi

# Update cloud-run-service-secure.yaml
if [ -f "cloud-run-service-secure.yaml" ]; then
    sed -i.bak "s/your-memorystore-redis-ip/$REDIS_HOST/g" cloud-run-service-secure.yaml
    echo "   ✅ Updated cloud-run-service-secure.yaml"
else
    echo "   ⚠️  cloud-run-service-secure.yaml not found"
fi

# Clean up backup files
rm -f *.bak

echo ""
echo "✅ All deployment files updated with Redis IP: $REDIS_HOST"
echo ""
echo "🚀 Next steps:"
echo "   1. Your Redis instance is ready to use"
echo "   2. All deployment files have been updated with the Redis IP"
echo "   3. You can now deploy your application:"
echo "      gcloud builds submit --config cloudbuild.yaml"
echo ""
echo "🔗 Useful commands:"
echo "   • Check Redis status: gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION"
echo "   • List all Redis instances: gcloud redis instances list"
echo "   • Delete Redis instance: gcloud redis instances delete $REDIS_INSTANCE_NAME --region=$REGION"