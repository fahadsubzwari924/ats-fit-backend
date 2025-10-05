#!/bin/bash

# Script to replace all placeholder values in deployment files
# Run this script after setting the correct values below

# ========================================
# CONFIGURATION - UPDATE THESE VALUES
# ========================================

# Your actual Google Cloud Project ID (REQUIRED)
ACTUAL_PROJECT_ID="ats-fit-backend"

# Your Redis Memorystore IP address (get this after creating Redis instance)
REDIS_IP="10.0.0.3"  # Replace with actual IP from: gcloud redis instances describe ats-fit-redis --region=us-central1 --format="value(host)"

# ========================================
# VALIDATION
# ========================================

if [ "$ACTUAL_PROJECT_ID" = "your-actual-project-id-here" ]; then
    echo "❌ Error: Please update ACTUAL_PROJECT_ID with your real Google Cloud project ID"
    echo "   Example: my-ats-backend-project"
    exit 1
fi

echo "✅ Project ID is set to: $ACTUAL_PROJECT_ID"

if [ "$REDIS_IP" = "10.0.0.3" ]; then
    echo "⚠️  Warning: Using default Redis IP. Update REDIS_IP after creating Redis instance"
    echo "   Get Redis IP with: gcloud redis instances describe ats-fit-redis --region=us-central1 --format=\"value(host)\""
fi

echo "🔄 Updating placeholder values in deployment files..."
echo "   Project ID: $ACTUAL_PROJECT_ID"
echo "   Redis IP: $REDIS_IP"

# ========================================
# UPDATE FILES
# ========================================

# Update cloudbuild.yaml
echo "📝 Updating cloudbuild.yaml..."
sed -i.bak "s/PROJECT_ID/$ACTUAL_PROJECT_ID/g" cloudbuild.yaml
sed -i.bak "s/your-memorystore-redis-ip/$REDIS_IP/g" cloudbuild.yaml

# Update cloud-run-service.yaml
echo "📝 Updating cloud-run-service.yaml..."
sed -i.bak "s/PROJECT_ID/$ACTUAL_PROJECT_ID/g" cloud-run-service.yaml
sed -i.bak "s/your-memorystore-redis-ip/$REDIS_IP/g" cloud-run-service.yaml

# Update cloud-run-service-secure.yaml
echo "📝 Updating cloud-run-service-secure.yaml..."
sed -i.bak "s/PROJECT_ID/$ACTUAL_PROJECT_ID/g" cloud-run-service-secure.yaml
sed -i.bak "s/your-memorystore-redis-ip/$REDIS_IP/g" cloud-run-service-secure.yaml

# Update GitHub Actions workflow
echo "📝 Updating .github/workflows/deploy.yml..."
sed -i.bak "s/your-project-id/$ACTUAL_PROJECT_ID/g" .github/workflows/deploy.yml

# Update all shell scripts
echo "📝 Updating shell scripts..."
find scripts/ -name "*.sh" -exec sed -i.bak "s/your-project-id/$ACTUAL_PROJECT_ID/g" {} \;

# Clean up backup files
echo "🧹 Cleaning up backup files..."
find . -name "*.bak" -delete

echo "✅ All placeholder values updated successfully!"
echo ""
echo "📋 Updated files:"
echo "   ✓ cloudbuild.yaml"
echo "   ✓ cloud-run-service.yaml" 
echo "   ✓ cloud-run-service-secure.yaml"
echo "   ✓ .github/workflows/deploy.yml"
echo "   ✓ scripts/*.sh"
echo ""
echo "🚀 Next steps:"
echo "   1. Review the updated files"
echo "   2. Create Redis instance: gcloud redis instances create ats-fit-redis --region=us-central1"
echo "   3. Update Redis IP if needed"
echo "   4. Deploy: gcloud builds submit --config cloudbuild.yaml"