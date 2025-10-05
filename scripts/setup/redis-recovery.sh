#!/bin/bash

# Recovery script for Redis creation after setup-gcp.sh
# Run this if Redis creation failed in the main setup

set -e

PROJECT_ID="ats-fit-backend"
REDIS_INSTANCE="ats-fit-redis"
REGION="asia-south1"

echo "🔄 Redis Recovery Script"
echo "========================"

# Set project
gcloud config set project $PROJECT_ID

# Check if Redis instance exists
echo "🔍 Checking Redis instance status..."
REDIS_STATUS=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format="value(state)" 2>/dev/null || echo "NOT_FOUND")

if [ "$REDIS_STATUS" = "NOT_FOUND" ]; then
    echo "🚀 Creating Redis instance..."
    
    gcloud redis instances create $REDIS_INSTANCE \
        --region=$REGION \
        --size=1 \
        --network=projects/$PROJECT_ID/global/networks/default \
        --redis-version=redis_6_x \
        --connect-mode=DIRECT_PEERING \
        --display-name="ATS Fit Redis Cache"
    
    echo "✅ Redis creation initiated!"
    echo "⏳ Waiting for Redis to be ready..."
    
elif [ "$REDIS_STATUS" = "READY" ]; then
    echo "✅ Redis instance is already ready!"
    
else
    echo "⏳ Redis instance exists but status is: $REDIS_STATUS"
    echo "   Waiting for it to be ready..."
fi

# Wait for Redis to be ready
echo "⏳ Waiting for Redis instance to be ready..."
while true; do
    STATUS=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format="value(state)" 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$STATUS" = "READY" ]; then
        echo "✅ Redis instance is ready!"
        break
    elif [ "$STATUS" = "NOT_FOUND" ]; then
        echo "❌ Redis instance not found. Please check if creation failed."
        exit 1
    else
        echo "   Current status: $STATUS (waiting...)"
        sleep 30
    fi
done

# Get Redis IP
REDIS_HOST=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format="value(host)")
REDIS_PORT=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format="value(port)")

echo ""
echo "📊 Redis Instance Details:"
echo "   Host: $REDIS_HOST"
echo "   Port: $REDIS_PORT"
echo "   Region: $REGION"

# Create or update Redis host secret
echo ""
echo "🔒 Creating/updating Redis host secret..."
if gcloud secrets describe redis-host >/dev/null 2>&1; then
    echo "   Updating existing redis-host secret..."
    echo -n "$REDIS_HOST" | gcloud secrets versions add redis-host --data-file=-
else
    echo "   Creating new redis-host secret..."
    echo -n "$REDIS_HOST" | gcloud secrets create redis-host --data-file=-
fi

# Update deployment files
echo ""
echo "🔧 Updating deployment files with Redis IP..."

# Update cloudbuild.yaml
if [ -f "cloudbuild.yaml" ]; then
    sed -i.bak "s/your-memorystore-redis-ip/$REDIS_HOST/g" cloudbuild.yaml
    echo "   ✅ Updated cloudbuild.yaml"
fi

# Update cloud-run-service.yaml
if [ -f "cloud-run-service.yaml" ]; then
    sed -i.bak "s/your-memorystore-redis-ip/$REDIS_HOST/g" cloud-run-service.yaml
    echo "   ✅ Updated cloud-run-service.yaml"
fi

# Update cloud-run-service-secure.yaml
if [ -f "cloud-run-service-secure.yaml" ]; then
    sed -i.bak "s/your-memorystore-redis-ip/$REDIS_HOST/g" cloud-run-service-secure.yaml
    echo "   ✅ Updated cloud-run-service-secure.yaml"
fi

# Clean up backup files
rm -f *.bak

echo ""
echo "✅ Redis recovery completed successfully!"
echo ""
echo "🎉 Next steps:"
echo "   1. Your Redis instance is ready at: $REDIS_HOST"
echo "   2. All deployment files have been updated"
echo "   3. You can now deploy your application:"
echo "      gcloud builds submit --config cloudbuild.yaml"
echo ""
echo "🔍 Verification commands:"
echo "   • Check Redis: gcloud redis instances describe $REDIS_INSTANCE --region=$REGION"
echo "   • Test connection: redis-cli -h $REDIS_HOST -p $REDIS_PORT ping"